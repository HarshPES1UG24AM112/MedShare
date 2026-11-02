import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope } from '../auth/auth.js';
import { query, queryOne, withRetry } from '../db/pool.js';
import { forbidden, notFound } from '../http/errors.js';
import { handler, id, idempotencyKey, idParam, listQuery, paginate } from '../http/helpers.js';

export const router = Router();
router.use(['/transfers', '/stock-requests'], authenticate);

const STATUSES = ['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'REJECTED', 'CANCELLED'] as const;
const STAGES = ['SOURCE_FACILITY', 'SOURCE_ORGANIZATION'] as const;

const ref = (alias: string) => `json_build_object('id', ${alias}.id, 'code', ${alias}.code, 'name', ${alias}.name)`;

const transferSelect = `
  SELECT t.id, t.code, t.status, t.created_at, t.updated_at,
         ${ref('s')} AS source_facility, ${ref('d')} AS destination_facility,
         (s.organization_id <> d.organization_id) AS cross_organization,
         json_build_object('id', u.id, 'name', u.full_name) AS requested_by,
         t.request_notes, t.rejection_reason, t.recommendation_id,
         (SELECT count(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS item_count,
         (SELECT coalesce(sum(ti.quantity), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS total_units,
         (SELECT string_agg(DISTINCT m.name, ', ') FROM transfer_items ti
            JOIN medicine_batches b ON b.id = ti.batch_id JOIN medicines m ON m.id = b.medicine_id WHERE ti.transfer_id = t.id) AS medicines
  FROM transfer_requests t
  JOIN facilities s ON s.id = t.source_facility_id
  JOIN facilities d ON d.id = t.destination_facility_id
  JOIN users u ON u.id = t.requested_by`;

/** Full transfer with lines, approvals, timeline and the actions this user may take. */
async function transferDetail(req: Request, transferId: number) {
  const user = currentUser(req);
  const t = await queryOne<Record<string, any>>(`${transferSelect} WHERE t.id = $1`, [transferId]);
  if (!t) throw notFound('Transfer');
  const src = t.sourceFacility.id as number;
  const dst = t.destinationFacility.id as number;
  if (!user.platformScope && !user.scopeFacilityIds.includes(src) && !user.scopeFacilityIds.includes(dst)) {
    throw forbidden('This transfer does not involve a facility in your scope');
  }
  const [items, approvals, timeline, actions] = await Promise.all([
    query(
      `SELECT ti.id, ti.batch_id, b.batch_number, b.expiry_date, b.status AS batch_status, (b.expiry_date - fn_today()) AS days_to_expiry,
              m.id AS medicine_id, m.code AS medicine_code, m.name AS medicine_name, fn_strength_label(m.id) AS strength_label, mu.name AS unit,
              ti.quantity, ti.quantity_received, ti.quantity_damaged_in_transit,
              si.qty_available AS source_available, si.qty_reserved AS source_reserved,
              f.stock_request_item_id, sri.stock_request_id
       FROM transfer_items ti
       JOIN medicine_batches b ON b.id = ti.batch_id
       JOIN medicines m ON m.id = b.medicine_id
       JOIN medicine_units mu ON mu.id = m.dispensing_unit_id
       JOIN transfer_requests t ON t.id = ti.transfer_id
       LEFT JOIN inventory si ON si.facility_id = t.source_facility_id AND si.batch_id = ti.batch_id
       LEFT JOIN stock_request_fulfilments f ON f.transfer_item_id = ti.id
       LEFT JOIN stock_request_items sri ON sri.id = f.stock_request_item_id
       WHERE ti.transfer_id = $1 ORDER BY m.name, b.expiry_date`,
      [transferId],
    ),
    query(
      `SELECT a.stage, a.decision, a.comment, a.decided_at, json_build_object('id', u.id, 'name', u.full_name) AS decided_by
       FROM transfer_approvals a JOIN users u ON u.id = a.decided_by WHERE a.transfer_id = $1 ORDER BY a.decided_at`,
      [transferId],
    ),
    query(
      `SELECT step, from_status, to_status, note, changed_at, time_in_state::text AS time_in_state,
              json_build_object('id', changed_by, 'name', changed_by_name) AS changed_by
       FROM v_transfer_timeline WHERE transfer_id = $1 ORDER BY step`,
      [transferId],
    ),
    // Mirrors the procedures' rules so the UI only offers valid actions; the procedures still enforce them.
    queryOne<Record<string, boolean>>(
      `SELECT
         (t.status = 'PENDING' AND $2 <> t.requested_by AND fn_user_has_permission($2, t.source_facility_id, 'transfer:approve')
          AND NOT EXISTS (SELECT 1 FROM transfer_approvals WHERE transfer_id = t.id AND stage = 'SOURCE_FACILITY'))           AS approve_facility,
         (t.status = 'PENDING' AND $2 <> t.requested_by AND s.organization_id <> d.organization_id
          AND fn_user_has_permission($2, t.source_facility_id, 'transfer:approve_org')
          AND NOT EXISTS (SELECT 1 FROM transfer_approvals WHERE transfer_id = t.id AND stage = 'SOURCE_ORGANIZATION'))       AS approve_organization,
         (t.status IN ('PENDING', 'APPROVED') AND ($2 = t.requested_by
          OR fn_user_has_permission($2, t.destination_facility_id, 'transfer:request')
          OR fn_user_has_permission($2, t.source_facility_id, 'transfer:approve')))                                          AS cancel,
         (t.status = 'APPROVED' AND fn_user_has_permission($2, t.source_facility_id, 'transfer:dispatch'))                  AS dispatch,
         (t.status = 'DISPATCHED' AND fn_user_has_permission($2, t.destination_facility_id, 'transfer:receive'))            AS receive
       FROM transfer_requests t JOIN facilities s ON s.id = t.source_facility_id JOIN facilities d ON d.id = t.destination_facility_id
       WHERE t.id = $1`,
      [transferId, user.id],
    ),
  ]);
  const requiredStages = t.crossOrganization ? [...STAGES] : ['SOURCE_FACILITY'];
  const allowed = actions ?? {};
  return {
    ...t,
    requiredStages,
    items,
    approvals,
    timeline,
    allowedActions: {
      approve: [allowed.approveFacility && 'SOURCE_FACILITY', allowed.approveOrganization && 'SOURCE_ORGANIZATION'].filter(Boolean),
      reject: [allowed.approveFacility && 'SOURCE_FACILITY', allowed.approveOrganization && 'SOURCE_ORGANIZATION'].filter(Boolean),
      cancel: !!allowed.cancel,
      dispatch: !!allowed.dispatch,
      receive: !!allowed.receive,
    },
  };
}

/**
 * Runs a stock/transfer routine: retries deadlocks/serialization failures, and
 * if a concurrent retry with the same idempotency key won the race (PK
 * violation), re-runs once so the stored result is returned.
 */
async function runRoutine(sql: string, params: unknown[]) {
  try {
    return await withRetry(() => query(sql, params));
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint === 'idempotency_keys_pkey') return query(sql, params);
    throw e;
  }
}

/* ---------------------------------------------------------------- reads ---- */

router.get(
  '/transfers',
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        status: z.enum(STATUSES).optional(),
        facilityId: id.optional(),
        direction: z.enum(['incoming', 'outgoing']).optional(),
        actionable: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const user = currentUser(req);
    const base = `
      SELECT x.* FROM (${transferSelect}) x
      WHERE ($1::int[] IS NULL OR ($2::text IS DISTINCT FROM 'incoming' AND (x.source_facility->>'id')::int = ANY($1::int[]))
                               OR ($2::text IS DISTINCT FROM 'outgoing' AND (x.destination_facility->>'id')::int = ANY($1::int[])))
        AND ($3::transfer_status IS NULL OR x.status = $3)
        AND ($4::text IS NULL OR x.code ILIKE '%' || $4 || '%' OR x.medicines ILIKE '%' || $4 || '%'
             OR x.source_facility->>'name' ILIKE '%' || $4 || '%' OR x.destination_facility->>'name' ILIKE '%' || $4 || '%')
        -- "Needs my action" = the approve/dispatch/receive rules of allowedActions (transferDetail):
        -- requesters never approve their own transfer, a stage is offered only while undecided,
        -- and organisation admins see cross-organisation transfers awaiting their stage.
        AND ($5::text IS NULL OR (
             (x.status = 'PENDING' AND $6 <> (x.requested_by->>'id')::bigint AND (
                  (fn_user_has_permission($6, (x.source_facility->>'id')::int, 'transfer:approve')
                   AND NOT EXISTS (SELECT 1 FROM transfer_approvals a WHERE a.transfer_id = x.id AND a.stage = 'SOURCE_FACILITY'))
               OR (x.cross_organization AND fn_user_has_permission($6, (x.source_facility->>'id')::int, 'transfer:approve_org')
                   AND NOT EXISTS (SELECT 1 FROM transfer_approvals a WHERE a.transfer_id = x.id AND a.stage = 'SOURCE_ORGANIZATION'))))
          OR (x.status = 'APPROVED' AND fn_user_has_permission($6, (x.source_facility->>'id')::int, 'transfer:dispatch'))
          OR (x.status = 'DISPATCHED' AND fn_user_has_permission($6, (x.destination_facility->>'id')::int, 'transfer:receive'))))`;
    res.json(
      await paginate(base, [scope, q.direction ?? null, q.status ?? null, q.search ?? null, q.actionable === 'true' ? 'y' : null, user.id], q,
        { createdAt: 'created_at', updatedAt: 'updated_at', code: 'code', status: 'status', totalUnits: 'total_units' }, 'createdAt', 'desc'),
    );
  }),
);

router.get(
  '/transfers/:id',
  handler(async (req, res) => {
    res.json(await transferDetail(req, idParam(req)));
  }),
);

/* -------------------------------------------------------------- workflow ---- */

const itemsSchema = z
  .array(z.object({ batchId: id, quantity: z.number().int().positive().max(10_000_000), stockRequestItemId: id.optional() }))
  .min(1)
  .max(50)
  .refine((items) => new Set(items.map((i) => i.batchId)).size === items.length, 'Each batch may appear once');

router.post(
  '/transfers',
  handler(async (req, res) => {
    const b = z
      .object({ sourceFacilityId: id, destinationFacilityId: id, items: itemsSchema, notes: z.string().trim().max(500).optional() })
      .refine((v) => v.sourceFacilityId !== v.destinationFacilityId, { path: ['destinationFacilityId'], message: 'Must differ from the source' })
      .parse(req.body);
    const items = b.items.map((i) => ({ batch_id: i.batchId, quantity: i.quantity, ...(i.stockRequestItemId ? { stock_request_item_id: i.stockRequestItemId } : {}) }));
    const [row] = await runRoutine('SELECT fn_create_transfer_request($1, $2, $3, $4::jsonb, $5, NULL, $6) AS id', [
      currentUser(req).id, b.sourceFacilityId, b.destinationFacilityId, JSON.stringify(items), b.notes ?? null, idempotencyKey(req),
    ]);
    res.status(201).json(await transferDetail(req, (row as { id: number }).id));
  }),
);

router.post(
  '/transfers/:id/approve',
  handler(async (req, res) => {
    const tid = idParam(req);
    const b = z.object({ stage: z.enum(STAGES).default('SOURCE_FACILITY'), comment: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    await runRoutine('CALL sp_approve_transfer($1, $2, $3, $4, $5, NULL)', [currentUser(req).id, tid, b.stage, b.comment ?? null, idempotencyKey(req)]);
    res.json(await transferDetail(req, tid));
  }),
);

router.post(
  '/transfers/:id/reject',
  handler(async (req, res) => {
    const tid = idParam(req);
    const b = z.object({ stage: z.enum(STAGES).default('SOURCE_FACILITY'), reason: z.string().trim().min(3).max(500) }).parse(req.body ?? {});
    await runRoutine('CALL sp_reject_transfer($1, $2, $3, $4, $5, NULL)', [currentUser(req).id, tid, b.reason, b.stage, idempotencyKey(req)]);
    res.json(await transferDetail(req, tid));
  }),
);

router.post(
  '/transfers/:id/cancel',
  handler(async (req, res) => {
    const tid = idParam(req);
    const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body ?? {});
    await runRoutine('CALL sp_cancel_transfer($1, $2, $3, $4, NULL)', [currentUser(req).id, tid, b.reason, idempotencyKey(req)]);
    res.json(await transferDetail(req, tid));
  }),
);

router.post(
  '/transfers/:id/dispatch',
  handler(async (req, res) => {
    const tid = idParam(req);
    const b = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    await runRoutine('CALL sp_dispatch_transfer($1, $2, $3, $4, NULL)', [currentUser(req).id, tid, b.note ?? null, idempotencyKey(req)]);
    res.json(await transferDetail(req, tid));
  }),
);

router.post(
  '/transfers/:id/receive',
  handler(async (req, res) => {
    const tid = idParam(req);
    const b = z
      .object({
        lines: z.array(z.object({ itemId: id, received: z.number().int().min(0), damaged: z.number().int().min(0) })).min(1).optional(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body ?? {});
    const lines = b.lines ? JSON.stringify(b.lines.map((l) => ({ item_id: l.itemId, received: l.received, damaged: l.damaged }))) : null;
    await runRoutine('CALL sp_receive_transfer($1, $2, $3::jsonb, $4, $5, NULL)', [currentUser(req).id, tid, lines, b.note ?? null, idempotencyKey(req)]);
    res.json(await transferDetail(req, tid));
  }),
);

/* -------------------------------------------------------- stock requests ---- */

const stockRequestSelect = `
  SELECT sr.id, sr.code, sr.status, sr.priority, sr.needed_by, sr.notes, sr.created_at, sr.closed_at,
         ${ref('f')} AS facility, json_build_object('id', u.id, 'name', u.full_name) AS requested_by,
         coalesce((SELECT json_agg(json_build_object(
                    'id', i.id, 'medicineId', m.id, 'medicineName', m.name, 'strengthLabel', fn_strength_label(m.id),
                    'quantityRequested', i.quantity_requested,
                    'quantityReceived', (SELECT coalesce(sum(ti.quantity_received), 0) FROM stock_request_fulfilments sf
                                         JOIN transfer_items ti ON ti.id = sf.transfer_item_id WHERE sf.stock_request_item_id = i.id),
                    'quantityInProgress', (SELECT coalesce(sum(ti.quantity), 0) FROM stock_request_fulfilments sf
                                           JOIN transfer_items ti ON ti.id = sf.transfer_item_id
                                           JOIN transfer_requests t ON t.id = ti.transfer_id
                                           WHERE sf.stock_request_item_id = i.id AND t.status IN ('PENDING', 'APPROVED', 'DISPATCHED')))
                    ORDER BY m.name)
                   FROM stock_request_items i JOIN medicines m ON m.id = i.medicine_id WHERE i.stock_request_id = sr.id), '[]') AS items
  FROM stock_requests sr
  JOIN facilities f ON f.id = sr.requesting_facility_id
  JOIN users u ON u.id = sr.requested_by`;

router.get(
  '/stock-requests',
  handler(async (req, res) => {
    const q = listQuery
      .extend({ status: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).optional(), facilityId: id.optional(), priority: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).optional() })
      .parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT x.* FROM (${stockRequestSelect}) x
      WHERE ($1::int[] IS NULL OR (x.facility->>'id')::int = ANY($1::int[]))
        AND ($2::stock_request_status IS NULL OR x.status = $2)
        AND ($3::request_priority IS NULL OR x.priority = $3)
        AND ($4::text IS NULL OR x.code ILIKE '%' || $4 || '%' OR x.items::text ILIKE '%' || $4 || '%')`;
    res.json(await paginate(base, [scope, q.status ?? null, q.priority ?? null, q.search ?? null], q,
      { createdAt: 'created_at', neededBy: 'needed_by', priority: 'priority', status: 'status' }, 'createdAt', 'desc'));
  }),
);

router.post(
  '/stock-requests',
  handler(async (req, res) => {
    const b = z
      .object({
        facilityId: id,
        priority: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).default('ROUTINE'),
        neededBy: z.string().date().optional(),
        notes: z.string().trim().max(500).optional(),
        items: z.array(z.object({ medicineId: id, quantity: z.number().int().positive().max(10_000_000) })).min(1).max(50)
          .refine((items) => new Set(items.map((i) => i.medicineId)).size === items.length, 'Each medicine may appear once'),
      })
      .parse(req.body);
    const row = await queryOne<{ id: number }>('SELECT fn_create_stock_request($1, $2, $3::jsonb, $4, $5, $6) AS id', [
      currentUser(req).id, b.facilityId, JSON.stringify(b.items.map((i) => ({ medicine_id: i.medicineId, quantity: i.quantity }))),
      b.priority, b.neededBy ?? null, b.notes ?? null,
    ]);
    res.status(201).json(await queryOne(`${stockRequestSelect} WHERE sr.id = $1`, [row!.id]));
  }),
);

router.post(
  '/stock-requests/:id/cancel',
  handler(async (req, res) => {
    const rid = idParam(req);
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body ?? {});
    await query('SELECT fn_cancel_stock_request($1, $2, $3)', [currentUser(req).id, rid, b.reason]);
    res.json(await queryOne(`${stockRequestSelect} WHERE sr.id = $1`, [rid]));
  }),
);
