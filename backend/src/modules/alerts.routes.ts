import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope, requirePermission } from '../auth/auth.js';
import { query, queryOne } from '../db/pool.js';
import { audit } from '../http/audit.js';
import { ApiError, notFound } from '../http/errors.js';
import { handler, id, idParam, listQuery, paginate } from '../http/helpers.js';

export const router = Router();
router.use(['/alerts', '/notifications'], authenticate);

/* ------------------------------------------------------------- shortages ---- */

router.get(
  '/alerts/shortages',
  handler(async (req, res) => {
    const q = listQuery.extend({ facilityId: id.optional(), severity: z.enum(['CRITICAL', 'LOW']).optional(), medicineId: id.optional() }).parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT ss.facility_id, ss.facility_code, ss.facility_name, ss.medicine_id, ss.medicine_code, ss.medicine_name,
             fn_strength_label(ss.medicine_id) AS strength_label, ss.stock_status AS severity, ss.usable AS current_stock,
             ss.min_stock_level, ss.reorder_threshold, ss.safety_stock, ss.daily_rate AS avg_daily_consumption,
             ss.demand_basis, d.possibly_censored, ss.days_of_inventory AS days_remaining,
             (ss.reorder_threshold - ss.usable) AS deficit, round(ss.usable::numeric / nullif(ss.reorder_threshold, 0), 3) AS coverage,
             a.id AS alert_id, a.status AS alert_status, a.detected_at, a.acknowledged_at
      FROM v_shortage_status ss
      JOIN v_demand d ON d.facility_id = ss.facility_id AND d.medicine_id = ss.medicine_id
      LEFT JOIN shortage_alerts a ON a.facility_id = ss.facility_id AND a.medicine_id = ss.medicine_id AND a.status <> 'RESOLVED'
      WHERE ss.stock_status <> 'OK'
        AND ($1::int[] IS NULL OR ss.facility_id = ANY($1::int[]))
        AND ($2::text IS NULL OR ss.stock_status = $2)
        AND ($3::int IS NULL OR ss.medicine_id = $3)
        AND ($4::text IS NULL OR ss.medicine_name ILIKE '%' || $4 || '%' OR ss.facility_name ILIKE '%' || $4 || '%')`;
    res.json(
      await paginate(base, [scope, q.severity ?? null, q.medicineId ?? null, q.search ?? null], q,
        { daysRemaining: 'days_remaining', coverage: 'coverage', deficit: 'deficit', medicine: 'medicine_name', facility: 'facility_name', currentStock: 'current_stock' },
        'coverage'),
    );
  }),
);

/* ---------------------------------------------------------------- expiry ---- */

const WINDOW = z.enum(['expired', '7', '30', '60']);
const windowFilter = `(CASE $2::text
    WHEN 'expired' THEN days_to_expiry < 0
    WHEN '7'  THEN days_to_expiry BETWEEN 0 AND 7
    WHEN '30' THEN days_to_expiry BETWEEN 0 AND 30
    WHEN '60' THEN days_to_expiry BETWEEN 0 AND 60 END)`;

router.get(
  '/alerts/expiry',
  handler(async (req, res) => {
    const q = listQuery.extend({ facilityId: id.optional(), window: WINDOW.default('30') }).parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT v.*, round((v.qty_available + v.qty_reserved) * v.unit_cost, 2) AS value_at_risk,
             (SELECT a.id FROM expiry_alerts a WHERE a.inventory_id = v.inventory_id AND a.status <> 'RESOLVED' LIMIT 1) AS alert_id
      FROM v_inventory_detail v
      WHERE v.qty_available + v.qty_reserved > 0
        AND ($1::int[] IS NULL OR v.facility_id = ANY($1::int[]))
        AND ${windowFilter}
        AND ($3::text IS NULL OR v.medicine_name ILIKE '%' || $3 || '%' OR v.batch_number ILIKE '%' || $3 || '%' OR v.facility_name ILIKE '%' || $3 || '%')`;
    res.json(
      await paginate(base, [scope, q.window, q.search ?? null], q,
        { daysToExpiry: 'days_to_expiry', quantity: 'qty_available', value: 'value_at_risk', medicine: 'medicine_name', facility: 'facility_name' },
        'daysToExpiry'),
    );
  }),
);

router.get(
  '/alerts/expiry/summary',
  handler(async (req, res) => {
    const q = z.object({ facilityId: id.optional() }).parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    res.json(
      await queryOne(
        `SELECT count(*) FILTER (WHERE days_to_expiry < 0)                               AS expired,
                count(*) FILTER (WHERE days_to_expiry BETWEEN 0 AND 7)                    AS within7,
                count(*) FILTER (WHERE days_to_expiry BETWEEN 0 AND 30)                   AS within30,
                count(*) FILTER (WHERE days_to_expiry BETWEEN 0 AND 60)                   AS within60,
                coalesce(sum(qty_available + qty_reserved) FILTER (WHERE days_to_expiry BETWEEN 0 AND 60), 0) AS units_at_risk,
                coalesce(round(sum((qty_available + qty_reserved) * unit_cost) FILTER (WHERE days_to_expiry BETWEEN 0 AND 60), 2), 0) AS value_at_risk,
                coalesce(round(sum((qty_available + qty_reserved) * unit_cost) FILTER (WHERE days_to_expiry < 0), 2), 0) AS expired_value
         FROM v_inventory_detail
         WHERE qty_available + qty_reserved > 0 AND ($1::int[] IS NULL OR facility_id = ANY($1::int[]))`,
        [scope],
      ),
    );
  }),
);

/* ------------------------------------------------------- acknowledgement ---- */

async function acknowledge(req: Request, table: 'shortage_alerts' | 'expiry_alerts') {
  const alertId = idParam(req);
  const facilitySql =
    table === 'shortage_alerts'
      ? 'SELECT facility_id, status FROM shortage_alerts WHERE id = $1'
      : 'SELECT i.facility_id, a.status FROM expiry_alerts a JOIN inventory i ON i.id = a.inventory_id WHERE a.id = $1';
  const alert = await queryOne<{ facilityId: number; status: string }>(facilitySql, [alertId]);
  if (!alert) throw notFound('Alert');
  facilityScope(req, alert.facilityId);
  // Acknowledging changes shared state, so read-only roles (auditors) may not do it.
  await requirePermission(req, 'inventory:write', alert.facilityId);
  if (alert.status !== 'OPEN') throw new ApiError(409, 'INVALID_STATE', `Alert is already ${alert.status.toLowerCase()}`);
  await query(`UPDATE ${table} SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = fn_now() WHERE id = $1`, [alertId, currentUser(req).id]);
  await audit(req, 'ALERT_ACKNOWLEDGED', table === 'shortage_alerts' ? 'SHORTAGE_ALERT' : 'EXPIRY_ALERT', alertId, alert.facilityId);
  return { id: alertId, status: 'ACKNOWLEDGED' };
}

router.post('/alerts/shortages/:id/acknowledge', handler(async (req, res) => res.json(await acknowledge(req, 'shortage_alerts'))));
router.post('/alerts/expiry/:id/acknowledge', handler(async (req, res) => res.json(await acknowledge(req, 'expiry_alerts'))));

/* --------------------------------------------------------- notifications ---- */

router.get(
  '/notifications',
  handler(async (req, res) => {
    const q = listQuery.extend({ unreadOnly: z.enum(['true', 'false']).default('false') }).parse(req.query);
    const base = `
      SELECT id, category, title, body, entity_type, entity_id, created_at, read_at
      FROM notifications WHERE recipient_user_id = $1 AND ($2 = 'false' OR read_at IS NULL)`;
    const page = await paginate(base, [currentUser(req).id, q.unreadOnly], q, { createdAt: 'created_at' }, 'createdAt', 'desc');
    const unread = await queryOne<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL', [currentUser(req).id]);
    res.json({ ...page, unreadCount: unread?.n ?? 0 });
  }),
);

router.post(
  '/notifications/:id/read',
  handler(async (req, res) => {
    const rows = await query('UPDATE notifications SET read_at = coalesce(read_at, fn_now()) WHERE id = $1 AND recipient_user_id = $2 RETURNING id', [
      idParam(req), currentUser(req).id,
    ]);
    if (!rows.length) throw notFound('Notification');
    res.status(204).end();
  }),
);

router.post(
  '/notifications/read-all',
  handler(async (req, res) => {
    await query('UPDATE notifications SET read_at = fn_now() WHERE recipient_user_id = $1 AND read_at IS NULL', [currentUser(req).id]);
    res.status(204).end();
  }),
);
