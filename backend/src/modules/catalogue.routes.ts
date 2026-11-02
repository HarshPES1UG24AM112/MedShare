import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requirePermission, requirePermissionAnywhere } from '../auth/auth.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { audit } from '../http/audit.js';
import { notFound } from '../http/errors.js';
import { handler, id, idParam, listQuery, paginate } from '../http/helpers.js';

export const router = Router();
router.use(['/medicines', '/catalogue', '/batches'], authenticate);

const DOSAGE_FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'INFUSION', 'INHALER', 'SACHET', 'CREAM', 'DROPS'] as const;
const UOMS = ['mg', 'mcg', 'g', 'IU', 'mL', '%', 'mg/mL', 'mg/5mL', 'IU/mL', 'mcg/dose', 'g/L'] as const;

/* -------------------------------------------------------------- lookups ---- */

router.get(
  '/catalogue/categories',
  handler(async (_req, res) => {
    res.json(
      await query(`
        SELECT ct.id, ct.parent_id, ct.name, ct.depth, ct.path,
               (SELECT count(*) FROM medicines m WHERE m.category_id IN (
                   SELECT d.id FROM v_category_tree d WHERE d.id = ct.id OR d.path LIKE ct.path || ' › %')) AS medicine_count
        FROM v_category_tree ct ORDER BY ct.path`),
    );
  }),
);

router.post(
  '/catalogue/categories',
  requirePermissionAnywhere('catalogue:manage'),
  handler(async (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(80), parentId: id.nullable().default(null), description: z.string().max(300).optional() }).parse(req.body);
    const row = await queryOne<{ id: number }>('INSERT INTO medicine_categories (parent_id, name, description) VALUES ($1, $2, $3) RETURNING id', [b.parentId, b.name, b.description ?? null]);
    await audit(req, 'CATEGORY_CREATED', 'MEDICINE_CATEGORY', row!.id, null, null, b);
    res.status(201).json(await queryOne('SELECT * FROM v_category_tree WHERE id = $1', [row!.id]));
  }),
);

router.get(
  '/catalogue/units',
  handler(async (_req, res) => {
    res.json(await query('SELECT id, code, name FROM medicine_units ORDER BY name'));
  }),
);

router.get(
  '/catalogue/substances',
  handler(async (req, res) => {
    const { search } = z.object({ search: z.string().trim().max(80).optional() }).parse(req.query);
    res.json(
      await query(
        `SELECT s.id, s.name, (SELECT count(*) FROM medicine_ingredients i WHERE i.substance_id = s.id) AS medicine_count
         FROM substances s WHERE $1::text IS NULL OR s.name ILIKE '%' || $1 || '%' ORDER BY s.name LIMIT 100`,
        [search || null],
      ),
    );
  }),
);

router.get(
  '/catalogue/manufacturers',
  handler(async (_req, res) => {
    res.json(
      await query(`SELECT mf.id, mf.name, mf.license_number, mf.country, mf.is_synthetic,
                          (SELECT count(*) FROM medicine_batches b WHERE b.manufacturer_id = mf.id) AS batch_count
                   FROM manufacturers mf ORDER BY mf.name`),
    );
  }),
);

router.post(
  '/catalogue/manufacturers',
  requirePermissionAnywhere('catalogue:manage'),
  handler(async (req, res) => {
    const b = z.object({ name: z.string().trim().min(3).max(160), licenseNumber: z.string().trim().min(3).max(60), country: z.string().trim().min(2).max(60).default('India') }).parse(req.body);
    const row = await queryOne<{ id: number }>(
      'INSERT INTO manufacturers (name, license_number, country, is_synthetic) VALUES ($1, $2, $3, false) RETURNING id',
      [b.name, b.licenseNumber, b.country],
    );
    await audit(req, 'MANUFACTURER_CREATED', 'MANUFACTURER', row!.id, null, null, b);
    res.status(201).json({ id: row!.id, ...b });
  }),
);

/* ------------------------------------------------------------ medicines ---- */

// Network totals (tier-2 visibility) are included; batch-level detail is scope-checked elsewhere.
const medicineSelect = `
  SELECT c.id, c.code, c.name, c.strength_label, c.display_name, c.dosage_form, c.unit_volume_ml, c.unit,
         c.category_id, c.category, c.category_path, c.requires_cold_chain, c.is_essential, c.is_active, c.description,
         c.substances, a.network_usable, a.facilities_holding, a.facilities_short, a.nearest_expiry, c.created_at, c.updated_at
  FROM v_medicine_catalogue c
  JOIN v_medicine_availability a ON a.medicine_id = c.id`;

router.get(
  '/medicines',
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        categoryId: id.optional(),
        dosageForm: z.enum(DOSAGE_FORMS).optional(),
        essential: z.enum(['true', 'false']).optional(),
        coldChain: z.enum(['true', 'false']).optional(),
        manufacturerId: id.optional(),
        active: z.enum(['true', 'false']).default('true'),
      })
      .parse(req.query);
    // Search covers designation, substances and manufacturers; category filter includes all descendants.
    const base = `
      ${medicineSelect}
      WHERE ($1::text IS NULL
             OR c.name ILIKE '%' || $1 || '%' OR c.code ILIKE '%' || $1 || '%'
             OR EXISTS (SELECT 1 FROM medicine_ingredients i JOIN substances s ON s.id = i.substance_id
                        WHERE i.medicine_id = c.id AND s.name ILIKE '%' || $1 || '%')
             OR EXISTS (SELECT 1 FROM medicine_batches b JOIN manufacturers mf ON mf.id = b.manufacturer_id
                        WHERE b.medicine_id = c.id AND mf.name ILIKE '%' || $1 || '%'))
        AND ($2::int IS NULL OR c.category_id IN (
              WITH RECURSIVE sub AS (SELECT id FROM medicine_categories WHERE id = $2
                                     UNION ALL SELECT mc.id FROM medicine_categories mc JOIN sub ON mc.parent_id = sub.id)
              SELECT id FROM sub))
        AND ($3::dosage_form IS NULL OR c.dosage_form = $3)
        AND ($4::text IS NULL OR c.is_essential = ($4 = 'true'))
        AND ($5::text IS NULL OR c.requires_cold_chain = ($5 = 'true'))
        AND ($6::int IS NULL OR EXISTS (SELECT 1 FROM medicine_batches b WHERE b.medicine_id = c.id AND b.manufacturer_id = $6))
        AND c.is_active = ($7 = 'true')`;
    res.json(
      await paginate(
        base,
        [q.search ?? null, q.categoryId ?? null, q.dosageForm ?? null, q.essential ?? null, q.coldChain ?? null, q.manufacturerId ?? null, q.active],
        q,
        { name: 'name', code: 'code', category: 'category_path', form: 'dosage_form', networkUsable: 'network_usable', facilitiesShort: 'facilities_short' },
        'name',
      ),
    );
  }),
);

async function medicineDetail(medicineId: number, scope: number[] | null) {
  const m = await queryOne<Record<string, unknown>>(`${medicineSelect} WHERE c.id = $1`, [medicineId]);
  if (!m) throw notFound('Medicine');
  const [ingredients, manufacturers, stockByFacility] = await Promise.all([
    query(
      `SELECT s.id AS substance_id, s.name AS substance, i.strength_value, i.strength_uom
       FROM medicine_ingredients i JOIN substances s ON s.id = i.substance_id WHERE i.medicine_id = $1 ORDER BY s.name`,
      [medicineId],
    ),
    query(
      `SELECT DISTINCT mf.id, mf.name FROM medicine_batches b JOIN manufacturers mf ON mf.id = b.manufacturer_id WHERE b.medicine_id = $1 ORDER BY mf.name`,
      [medicineId],
    ),
    query(
      `SELECT fs.facility_id, f.code AS facility_code, f.name AS facility_name, fs.usable, fs.reserved, fs.damaged,
              fs.expired_on_hand, fs.batches_on_hand, fs.nearest_usable_expiry,
              ss.reorder_threshold, ss.min_stock_level, ss.stock_status, ss.days_of_inventory
       FROM v_facility_stock fs
       JOIN facilities f ON f.id = fs.facility_id
       LEFT JOIN v_shortage_status ss ON ss.facility_id = fs.facility_id AND ss.medicine_id = fs.medicine_id
       WHERE fs.medicine_id = $1 AND ($2::int[] IS NULL OR fs.facility_id = ANY($2::int[]))
         AND (fs.usable > 0 OR fs.reserved > 0 OR fs.batches_on_hand > 0)
       ORDER BY f.code`,
      [medicineId, scope],
    ),
  ]);
  return { ...m, ingredients, manufacturers, stockByFacility };
}

/**
 * Sourcing options for a transfer INTO a facility the caller may request for.
 * Returns only transfer-eligible batches (ACTIVE, enough shelf life, stock
 * available) at authorised partner facilities within dispatch range, FEFO
 * first. This is the narrow, purpose-bound exception to batch-level visibility
 * (design §8.11): partner batches are visible only for a transfer involving
 * the caller's own facility.
 */
router.get(
  '/medicines/:id/sources',
  handler(async (req, res) => {
    const medicineId = idParam(req);
    const { destinationFacilityId } = z.object({ destinationFacilityId: id }).parse(req.query);
    await requirePermission(req, 'transfer:request', destinationFacilityId);
    res.json(
      await query(
        // Authorisation and distance depend only on the facility pair, so they are evaluated once per
        // partner facility (MATERIALIZED stops the planner inlining them back into the per-batch rows).
        // See docs/perf/EXPLAIN_RESULTS.md, Q2.
        `WITH partners AS MATERIALIZED (
           SELECT f.id, f.code, f.name, f.has_cold_chain, d.has_cold_chain AS destination_cold_chain,
                  fn_distance_km(f.id, d.id) AS distance_km, (f.organization_id <> d.organization_id) AS cross_organization
           FROM facilities f
           JOIN facilities d ON d.id = $2
           WHERE f.id <> d.id AND f.is_active
             AND fn_is_transfer_authorised(f.id, d.id)
             AND fn_distance_km(f.id, d.id) <= f.max_dispatch_radius_km
         )
         SELECT i.id AS inventory_id, b.id AS batch_id, b.batch_number, b.expiry_date, (b.expiry_date - fn_today()) AS days_to_expiry,
                i.qty_available, json_build_object('id', p.id, 'code', p.code, 'name', p.name) AS facility,
                p.distance_km, p.cross_organization, ss.stock_status AS source_stock_status
         FROM partners p
         JOIN inventory i ON i.facility_id = p.id
         JOIN medicine_batches b ON b.id = i.batch_id
         JOIN medicines m ON m.id = b.medicine_id
         CROSS JOIN engine_config e
         LEFT JOIN v_shortage_status ss ON ss.facility_id = p.id AND ss.medicine_id = m.id
         WHERE b.medicine_id = $1 AND i.qty_available > 0
           AND b.status = 'ACTIVE' AND b.expiry_date >= fn_today() + e.min_remaining_shelf_life_days
           AND (NOT m.requires_cold_chain OR (p.has_cold_chain AND p.destination_cold_chain))
         ORDER BY b.expiry_date, p.distance_km
         LIMIT 50`,
        [medicineId, destinationFacilityId],
      ),
    );
  }),
);

router.get(
  '/medicines/:id',
  handler(async (req, res) => {
    const user = currentUser(req);
    res.json(await medicineDetail(idParam(req), user.platformScope ? null : user.scopeFacilityIds));
  }),
);

const ingredient = z.object({
  substanceId: id.optional(),
  substanceName: z.string().trim().min(2).max(120).optional(),
  strengthValue: z.number().positive().max(1_000_000),
  strengthUom: z.enum(UOMS),
}).refine((i) => i.substanceId || i.substanceName, { message: 'Give substanceId or substanceName' });

const medicineBody = z.object({
  code: z.string().trim().regex(/^MED-[0-9]{4}$/, 'Use the format MED-0000').optional(),
  name: z.string().trim().min(2).max(160),
  dosageForm: z.enum(DOSAGE_FORMS),
  unitVolumeMl: z.number().positive().max(10_000).nullable().default(null),
  categoryId: id,
  dispensingUnitId: id,
  requiresColdChain: z.boolean().default(false),
  isEssential: z.boolean().default(false),
  description: z.string().trim().max(1000).nullable().default(null),
  ingredients: z.array(ingredient).min(1, 'At least one ingredient').max(8),
});

type IngredientInput = z.infer<typeof ingredient>;

async function writeIngredients(c: Parameters<Parameters<typeof withTransaction>[0]>[0], medicineId: number, items: IngredientInput[]) {
  await c.query('DELETE FROM medicine_ingredients WHERE medicine_id = $1', [medicineId]);
  for (const i of items) {
    let substanceId = i.substanceId;
    if (!substanceId) {
      const { rows } = await c.query(
        `INSERT INTO substances (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [i.substanceName],
      );
      substanceId = rows[0].id;
    }
    await c.query('INSERT INTO medicine_ingredients (medicine_id, substance_id, strength_value, strength_uom) VALUES ($1, $2, $3, $4)', [
      medicineId, substanceId, i.strengthValue, i.strengthUom,
    ]);
  }
}

router.post(
  '/medicines',
  requirePermissionAnywhere('catalogue:manage'),
  handler(async (req, res) => {
    const b = medicineBody.parse(req.body);
    // The composition trigger is DEFERRED: duplicate or empty compositions fail at COMMIT and roll everything back.
    const medicineId = await withTransaction(async (c) => {
      const code = b.code ?? (await c.query(`SELECT 'MED-' || lpad((coalesce(max(substr(code, 5)::int), 0) + 1)::text, 4, '0') AS code FROM medicines`)).rows[0].code;
      const { rows } = await c.query(
        `INSERT INTO medicines (code, name, dosage_form, unit_volume_ml, category_id, dispensing_unit_id, requires_cold_chain, is_essential, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [code, b.name, b.dosageForm, b.unitVolumeMl, b.categoryId, b.dispensingUnitId, b.requiresColdChain, b.isEssential, b.description],
      );
      await writeIngredients(c, rows[0].id, b.ingredients);
      await audit(req, 'MEDICINE_CREATED', 'MEDICINE', rows[0].id, null, null, { ...b, code }, c);
      return rows[0].id as number;
    });
    res.status(201).json(await medicineDetail(medicineId, null));
  }),
);

router.patch(
  '/medicines/:id',
  requirePermissionAnywhere('catalogue:manage'),
  handler(async (req, res) => {
    const medicineId = idParam(req);
    const b = medicineBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    await withTransaction(async (c) => {
      const before = (await c.query('SELECT * FROM medicines WHERE id = $1 FOR UPDATE', [medicineId])).rows[0];
      if (!before) throw notFound('Medicine');
      await c.query(
        `UPDATE medicines SET name = coalesce($2, name), dosage_form = coalesce($3, dosage_form),
                unit_volume_ml = CASE WHEN $4::boolean THEN $5 ELSE unit_volume_ml END,
                category_id = coalesce($6, category_id), dispensing_unit_id = coalesce($7, dispensing_unit_id),
                requires_cold_chain = coalesce($8, requires_cold_chain), is_essential = coalesce($9, is_essential),
                description = CASE WHEN $10::boolean THEN $11 ELSE description END, is_active = coalesce($12, is_active)
         WHERE id = $1`,
        [medicineId, b.name, b.dosageForm, 'unitVolumeMl' in b, b.unitVolumeMl ?? null, b.categoryId, b.dispensingUnitId,
         b.requiresColdChain, b.isEssential, 'description' in b, b.description ?? null, b.isActive],
      );
      if (b.ingredients) await writeIngredients(c, medicineId, b.ingredients);
      await audit(req, 'MEDICINE_UPDATED', 'MEDICINE', medicineId, null, { name: before.name, is_active: before.is_active }, b, c);
    });
    res.json(await medicineDetail(medicineId, null));
  }),
);

/* -------------------------------------------------------------- batches ---- */

// A batch (lot) is master data: number, medicine, manufacturer, dates, status.
// Holdings are reported as network totals plus in-scope detail.
const batchSelect = `
  SELECT b.id, b.batch_number, b.medicine_id, m.code AS medicine_code, m.name AS medicine_name, fn_strength_label(m.id) AS strength_label,
         b.manufacturer_id, mf.name AS manufacturer, b.manufacture_date, b.expiry_date, (b.expiry_date - fn_today()) AS days_to_expiry,
         CASE WHEN b.expiry_date <  fn_today()      THEN 'EXPIRED'
              WHEN b.expiry_date <= fn_today() + 7  THEN 'WITHIN_7_DAYS'
              WHEN b.expiry_date <= fn_today() + 30 THEN 'WITHIN_30_DAYS'
              WHEN b.expiry_date <= fn_today() + 60 THEN 'WITHIN_60_DAYS' ELSE 'HEALTHY' END AS expiry_bucket,
         b.unit_cost, b.status, b.status_reason,
         (SELECT coalesce(sum(i.qty_available + i.qty_reserved), 0) FROM inventory i WHERE i.batch_id = b.id) AS network_on_hand,
         (SELECT count(*) FROM inventory i WHERE i.batch_id = b.id AND i.qty_available + i.qty_reserved > 0) AS facilities_holding,
         b.created_at
  FROM medicine_batches b
  JOIN medicines m ON m.id = b.medicine_id
  JOIN manufacturers mf ON mf.id = b.manufacturer_id`;

router.get(
  '/batches',
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        medicineId: id.optional(),
        manufacturerId: id.optional(),
        status: z.enum(['ACTIVE', 'QUARANTINED', 'RECALLED']).optional(),
        expiryBucket: z.enum(['EXPIRED', 'WITHIN_7_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'HEALTHY']).optional(),
        onHandOnly: z.enum(['true', 'false']).default('false'),
      })
      .parse(req.query);
    const base = `
      SELECT x.* FROM (${batchSelect}) x
      WHERE ($1::text IS NULL OR x.batch_number ILIKE '%' || $1 || '%' OR x.medicine_name ILIKE '%' || $1 || '%' OR x.manufacturer ILIKE '%' || $1 || '%')
        AND ($2::int IS NULL OR x.medicine_id = $2)
        AND ($3::int IS NULL OR x.manufacturer_id = $3)
        AND ($4::batch_status IS NULL OR x.status = $4)
        AND ($5::text IS NULL OR x.expiry_bucket = $5)
        AND ($6 = 'false' OR x.network_on_hand > 0)`;
    res.json(
      await paginate(base, [q.search ?? null, q.medicineId ?? null, q.manufacturerId ?? null, q.status ?? null, q.expiryBucket ?? null, q.onHandOnly], q,
        { expiryDate: 'expiry_date', batchNumber: 'batch_number', medicine: 'medicine_name', onHand: 'network_on_hand', status: 'status' }, 'expiryDate'),
    );
  }),
);

router.get(
  '/batches/:id',
  handler(async (req, res) => {
    const batchId = idParam(req);
    const b = await queryOne(`${batchSelect} WHERE b.id = $1`, [batchId]);
    if (!b) throw notFound('Batch');
    const user = currentUser(req);
    const holdings = await query(
      `SELECT i.id AS inventory_id, i.facility_id, f.code AS facility_code, f.name AS facility_name,
              i.qty_available, i.qty_reserved, i.qty_damaged, i.updated_at
       FROM inventory i JOIN facilities f ON f.id = i.facility_id
       WHERE i.batch_id = $1 AND ($2::int[] IS NULL OR i.facility_id = ANY($2::int[]))
       ORDER BY f.code`,
      [batchId, user.platformScope ? null : user.scopeFacilityIds],
    );
    res.json({ ...b, holdings });
  }),
);

router.post(
  '/batches/:id/status',
  handler(async (req, res) => {
    const batchId = idParam(req);
    const b = z.object({ status: z.enum(['ACTIVE', 'QUARANTINED', 'RECALLED']), reason: z.string().trim().max(300).optional() }).parse(req.body);
    await requirePermission(req, 'batch:manage');
    await query('SELECT fn_set_batch_status($1, $2, $3, $4)', [currentUser(req).id, batchId, b.status, b.reason ?? null]);
    res.json(await queryOne(`${batchSelect} WHERE b.id = $1`, [batchId]));
  }),
);
