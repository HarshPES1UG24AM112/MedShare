import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope, requirePermissionAnywhere } from '../auth/auth.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { prisma } from '../db/prisma.js';
import { audit } from '../http/audit.js';
import { ApiError, forbidden } from '../http/errors.js';
import { handler, id, listQuery, paginate } from '../http/helpers.js';
import { JOBS, type JobName } from '../jobs.js';

export const router = Router();
router.use(['/admin', '/audit-logs'], authenticate);

const requireSystemAdmin = (req: Request) => {
  if (!currentUser(req).roles.some((r) => r.role === 'SYSTEM_ADMIN')) throw forbidden('System administrator role required');
};

/* ---------------------------------------------------------------- audit ---- */

// Platform auditors / system admins see everything; organisation-scoped
// auditors and org admins see entries for facilities in their scope.
router.get(
  '/audit-logs',
  requirePermissionAnywhere('audit:read'),
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        entityType: z.string().regex(/^[A-Z_]+$/).optional(),
        entityId: z.string().max(40).optional(),
        action: z.string().regex(/^[A-Z_]+$/).optional(),
        actorId: id.optional(),
        facilityId: id.optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      })
      .refine((v) => !v.from || !v.to || v.from <= v.to, { path: ['to'], message: 'Must be on or after "from"' })
      .parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.old_values, a.new_values, a.request_id, host(a.ip_address) AS ip_address,
             CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'name', u.full_name, 'email', u.email::text) END AS actor,
             CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id', f.id, 'code', f.code, 'name', f.name) END AS facility
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      LEFT JOIN facilities f ON f.id = a.facility_id
      WHERE ($1::int[] IS NULL OR a.facility_id = ANY($1::int[]))
        AND ($2::text IS NULL OR a.entity_type = $2) AND ($3::text IS NULL OR a.entity_id = $3)
        AND ($4::text IS NULL OR a.action = $4) AND ($5::bigint IS NULL OR a.actor_user_id = $5)
        AND ($6::date IS NULL OR a.occurred_at >= $6::date) AND ($7::date IS NULL OR a.occurred_at < $7::date + 1)
        AND ($8::text IS NULL OR a.action ILIKE '%' || $8 || '%' OR u.full_name ILIKE '%' || $8 || '%' OR a.new_values::text ILIKE '%' || $8 || '%')`;
    res.json(
      await paginate(base,
        [scope, q.entityType ?? null, q.entityId ?? null, q.action ?? null, q.actorId ?? null, q.from ?? null, q.to ?? null, q.search ?? null],
        q, { occurredAt: 'occurred_at', action: 'action', entityType: 'entity_type' }, 'occurredAt', 'desc'),
    );
  }),
);

/* ------------------------------------------------------- reconciliation ---- */

// Proves balances = ledger and reservations = open transfers, from ONE snapshot.
router.post(
  '/admin/reconciliation',
  requirePermissionAnywhere('report:read'),
  handler(async (req, res) => {
    const b = z.object({ facilityId: id.optional() }).parse(req.body ?? {});
    const scope = facilityScope(req, b.facilityId);
    const discrepancies = await withTransaction(
      async (c) => {
        if (scope === null) return query('SELECT * FROM fn_reconcile_inventory(NULL)', [], c);
        const out: unknown[] = [];
        for (const f of scope) out.push(...(await query('SELECT * FROM fn_reconcile_inventory($1)', [f], c)));
        return out;
      },
      { isolation: 'REPEATABLE READ', readOnly: true },
    );
    await audit(req, 'RECONCILIATION_RUN', 'INVENTORY', null, b.facilityId ?? null, null, { discrepancies: discrepancies.length, scope: scope ?? 'NETWORK' });
    res.json({ checkedAt: new Date().toISOString(), scope: scope ?? 'NETWORK', isolation: 'REPEATABLE READ', count: discrepancies.length, discrepancies });
  }),
);

/* ------------------------------------------------------- engine config ---- */

router.get(
  '/admin/engine-config',
  handler(async (_req, res) => {
    res.json(await queryOne('SELECT * FROM engine_config'));
  }),
);

router.patch(
  '/admin/engine-config',
  handler(async (req, res) => {
    requireSystemAdmin(req);
    const b = z
      .object({
        planningHorizonDays: z.number().int().min(1).max(365),
        minRemainingShelfLifeDays: z.number().int().min(0).max(365),
        nearExpiryWindowDays: z.number().int().min(1).max(365),
        measuredDemandMinHistoryDays: z.number().int().min(7).max(365),
        largeAdjustmentAuditUnits: z.number().int().positive(),
      })
      .partial()
      .parse(req.body);
    const before = await prisma.engine_config.findUnique({ where: { id: true } });
    await prisma.engine_config.update({
      where: { id: true },
      data: {
        planning_horizon_days: b.planningHorizonDays,
        min_remaining_shelf_life_days: b.minRemainingShelfLifeDays,
        near_expiry_window_days: b.nearExpiryWindowDays,
        measured_demand_min_history_days: b.measuredDemandMinHistoryDays,
        large_adjustment_audit_units: b.largeAdjustmentAuditUnits,
        updated_by: BigInt(currentUser(req).id),
      },
    });
    await audit(req, 'ENGINE_CONFIG_UPDATED', 'ENGINE_CONFIG', 'singleton', null, before, b);
    res.json(await queryOne('SELECT * FROM engine_config'));
  }),
);

/* ---------------------------------------------------------------- jobs ---- */

router.post(
  '/admin/jobs/:job',
  handler(async (req, res) => {
    requireSystemAdmin(req);
    const job = req.params.job as JobName;
    if (!(job in JOBS)) throw new ApiError(404, 'NOT_FOUND', `Unknown job. Use one of: ${Object.keys(JOBS).join(', ')}`);
    const result = job === 'recommendations' ? await JOBS.recommendations(currentUser(req).id) : await JOBS[job]();
    await audit(req, 'JOB_RUN', 'SYSTEM', job, null, null, result);
    res.json({ job, ...result });
  }),
);

/* ---------------------------------------------------------- reference ---- */

router.get(
  '/admin/roles',
  handler(async (_req, res) => {
    res.json(
      await query(`SELECT r.code, r.name, r.grant_level, r.description,
                          array_agg(rp.permission_code ORDER BY rp.permission_code) AS permissions
                   FROM roles r JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.id`),
    );
  }),
);
