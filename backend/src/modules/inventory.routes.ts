import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope } from '../auth/auth.js';
import { query, queryOne, withRetry } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import { handler, id, idempotencyKey, idParam, listQuery, paginate } from '../http/helpers.js';

export const router = Router();
router.use('/inventory', authenticate);

const BUCKETS = ['EXPIRED', 'WITHIN_7_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'HEALTHY'] as const;

const inventorySort = {
  medicine: 'medicine_name', facility: 'facility_name', batchNumber: 'batch_number', expiryDate: 'expiry_date',
  available: 'qty_available', reserved: 'qty_reserved', damaged: 'qty_damaged', value: 'available_value', updatedAt: 'updated_at',
};

async function inventoryRow(inventoryId: number) {
  const row = await queryOne('SELECT * FROM v_inventory_detail WHERE inventory_id = $1', [inventoryId]);
  if (!row) throw notFound('Inventory row');
  return row;
}

/** Inventory rows are operational detail: only facilities in the caller's scope. */
router.get(
  '/inventory',
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        facilityId: id.optional(),
        medicineId: id.optional(),
        batchId: id.optional(),
        expiryBucket: z.enum(BUCKETS).optional(),
        batchStatus: z.enum(['ACTIVE', 'QUARANTINED', 'RECALLED']).optional(),
        onHandOnly: z.enum(['true', 'false']).default('true'),
      })
      .parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT * FROM v_inventory_detail
      WHERE ($1::int[] IS NULL OR facility_id = ANY($1::int[]))
        AND ($2::int IS NULL OR medicine_id = $2)
        AND ($3::int IS NULL OR batch_id = $3)
        AND ($4::text IS NULL OR expiry_bucket = $4)
        AND ($5::batch_status IS NULL OR batch_status = $5)
        AND ($6 = 'false' OR qty_available + qty_reserved + qty_damaged > 0)
        AND ($7::text IS NULL OR medicine_name ILIKE '%' || $7 || '%' OR batch_number ILIKE '%' || $7 || '%' OR facility_name ILIKE '%' || $7 || '%')`;
    res.json(
      await paginate(base, [scope, q.medicineId ?? null, q.batchId ?? null, q.expiryBucket ?? null, q.batchStatus ?? null, q.onHandOnly, q.search ?? null],
        q, inventorySort, 'expiryDate'),
    );
  }),
);

router.get(
  '/inventory/movements',
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        facilityId: id.optional(),
        medicineId: id.optional(),
        batchId: id.optional(),
        inventoryId: id.optional(),
        type: z.string().regex(/^[A-Z_]+$/).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      })
      .parse(req.query);
    const scope = facilityScope(req, q.facilityId);
    const base = `
      SELECT mv.id, mv.created_at, mv.movement_type, t.description AS movement_description, mv.quantity,
             mv.quantity * t.effect_available AS delta_available, mv.quantity * t.effect_reserved AS delta_reserved,
             mv.quantity * t.effect_damaged AS delta_damaged,
             mv.inventory_id, i.facility_id, f.code AS facility_code, f.name AS facility_name,
             b.id AS batch_id, b.batch_number, m.id AS medicine_id, m.name AS medicine_name, fn_strength_label(m.id) AS strength_label,
             mv.reason, mv.reference, mv.transfer_item_id, tr.id AS transfer_id, tr.code AS transfer_code,
             mv.performed_by, u.full_name AS performed_by_name
      FROM inventory_movements mv
      JOIN movement_types t ON t.code = mv.movement_type
      JOIN inventory i ON i.id = mv.inventory_id
      JOIN facilities f ON f.id = i.facility_id
      JOIN medicine_batches b ON b.id = i.batch_id
      JOIN medicines m ON m.id = b.medicine_id
      JOIN users u ON u.id = mv.performed_by
      LEFT JOIN transfer_items ti ON ti.id = mv.transfer_item_id
      LEFT JOIN transfer_requests tr ON tr.id = ti.transfer_id
      WHERE ($1::int[] IS NULL OR i.facility_id = ANY($1::int[]))
        AND ($2::int IS NULL OR m.id = $2) AND ($3::int IS NULL OR b.id = $3) AND ($4::int IS NULL OR mv.inventory_id = $4)
        AND ($5::text IS NULL OR mv.movement_type = $5)
        AND ($6::date IS NULL OR mv.created_at >= $6::date) AND ($7::date IS NULL OR mv.created_at < $7::date + 1)
        AND ($8::text IS NULL OR m.name ILIKE '%' || $8 || '%' OR b.batch_number ILIKE '%' || $8 || '%' OR mv.reference ILIKE '%' || $8 || '%')`;
    res.json(
      await paginate(base,
        [scope, q.medicineId ?? null, q.batchId ?? null, q.inventoryId ?? null, q.type ?? null, q.from ?? null, q.to ?? null, q.search ?? null],
        q, { createdAt: 'created_at', quantity: 'quantity', medicine: 'medicine_name', type: 'movement_type' }, 'createdAt', 'desc'),
    );
  }),
);

router.get(
  '/inventory/:id',
  handler(async (req, res) => {
    const row = (await inventoryRow(idParam(req))) as { facilityId: number };
    facilityScope(req, row.facilityId);
    res.json(row);
  }),
);

/* ---------------------------------------------------------- stock changes ---- */
// Permission (inventory:write at the row's facility) is enforced inside each
// SECURITY DEFINER routine; the API passes the authenticated user as actor.

router.post(
  '/inventory/receipts',
  handler(async (req, res) => {
    const b = z
      .object({
        facilityId: id,
        medicineId: id,
        manufacturerId: id,
        batchNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/, 'Letters, digits and dashes (3–30)'),
        manufactureDate: z.string().date(),
        expiryDate: z.string().date(),
        unitCost: z.number().min(0).max(1_000_000),
        quantity: z.number().int().positive().max(10_000_000),
        reference: z.string().trim().max(60).optional(),
      })
      .refine((v) => v.expiryDate > v.manufactureDate, { path: ['expiryDate'], message: 'Must be after the manufacture date' })
      .parse(req.body);
    const key = idempotencyKey(req);
    const row = await withRetry(() =>
      queryOne<{ pInventoryId: number }>('CALL sp_receive_stock($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)', [
        currentUser(req).id, b.facilityId, b.medicineId, b.manufacturerId, b.batchNumber, b.manufactureDate, b.expiryDate,
        b.unitCost, b.quantity, b.reference ?? null, key,
      ]),
    );
    res.status(201).json(await inventoryRow(row!.pInventoryId));
  }),
);

const qty = z.number().int().positive().max(10_000_000);
const reason = z.string().trim().min(3, 'Give a short reason').max(300);

function ledgerRoute(path: string, schema: z.ZodTypeAny, call: (req: Request, inventoryId: number, body: any) => Promise<unknown>) {
  router.post(
    `/inventory/:id/${path}`,
    handler(async (req, res) => {
      const inventoryId = idParam(req);
      const body = schema.parse(req.body ?? {});
      await withRetry(() => call(req, inventoryId, body));
      res.json(await inventoryRow(inventoryId));
    }),
  );
}

ledgerRoute('dispense', z.object({ quantity: qty, reference: z.string().trim().max(60).optional() }), (req, inv, b) =>
  query('SELECT fn_record_dispense($1, $2, $3, $4)', [currentUser(req).id, inv, b.quantity, b.reference ?? null]));
ledgerRoute('damage', z.object({ quantity: qty, reason }), (req, inv, b) =>
  query('SELECT fn_record_damage($1, $2, $3, $4)', [currentUser(req).id, inv, b.quantity, b.reason]));
ledgerRoute('dispose', z.object({ quantity: qty, reason }), (req, inv, b) =>
  query('SELECT fn_dispose_damaged($1, $2, $3, $4)', [currentUser(req).id, inv, b.quantity, b.reason]));
ledgerRoute('write-off', z.object({ quantity: qty.optional(), reason: reason.default('Expired stock written off') }), async (req, inv, b) => {
  const quantity = b.quantity ?? ((await inventoryRow(inv)) as { qtyAvailable: number }).qtyAvailable;
  return query('SELECT fn_write_off_expired($1, $2, $3, $4)', [currentUser(req).id, inv, quantity, b.reason]);
});
ledgerRoute('adjust', z.object({ delta: z.number().int().refine((d) => d !== 0, 'Must be non-zero'), reason }), (req, inv, b) =>
  query('SELECT fn_adjust_stock($1, $2, $3, $4)', [currentUser(req).id, inv, b.delta, b.reason]));
