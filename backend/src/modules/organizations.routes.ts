import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope, hasPermission, requirePermission } from '../auth/auth.js';
import { query, queryOne } from '../db/pool.js';
import { prisma } from '../db/prisma.js';
import { audit } from '../http/audit.js';
import { forbidden, notFound } from '../http/errors.js';
import { handler, id, idParam, listQuery, paginate } from '../http/helpers.js';

export const router = Router();
router.use(['/organizations', '/facilities', '/regions'], authenticate);

const ORG_TYPES = ['HOSPITAL_NETWORK', 'PHARMACY_CHAIN', 'PUBLIC_HEALTH_AUTHORITY', 'MEDICAL_WAREHOUSE', 'NGO'] as const;
const FACILITY_TYPES = ['HOSPITAL', 'COMMUNITY_HEALTH_CENTRE', 'PRIMARY_HEALTH_CENTRE', 'PHARMACY', 'WAREHOUSE'] as const;

/* ------------------------------------------------------------- regions ---- */

router.get(
  '/regions',
  handler(async (_req, res) => {
    res.json(await query('SELECT id, parent_id, code, name, depth, level, path FROM v_region_tree ORDER BY path'));
  }),
);

/* -------------------------------------------------------- organisations ---- */

router.get(
  '/organizations',
  handler(async (_req, res) => {
    res.json(
      await query(`
        SELECT o.id, o.name, o.org_type, o.registration_number, o.contact_email::text AS contact_email, o.is_active, o.is_synthetic,
               (SELECT count(*) FROM facilities f WHERE f.organization_id = o.id) AS facility_count
        FROM organizations o ORDER BY o.name`),
    );
  }),
);

const orgBody = z.object({
  name: z.string().trim().min(3).max(160),
  orgType: z.enum(ORG_TYPES),
  registrationNumber: z.string().trim().min(3).max(40),
  contactEmail: z.string().trim().email().optional(),
  isActive: z.boolean().default(true),
});

router.post(
  '/organizations',
  handler(async (req, res) => {
    await requirePermission(req, 'organization:manage');
    const b = orgBody.parse(req.body);
    const org = await prisma.organizations.create({
      data: { name: b.name, org_type: b.orgType, registration_number: b.registrationNumber, contact_email: b.contactEmail, is_active: b.isActive, is_synthetic: false },
    });
    await audit(req, 'ORGANIZATION_CREATED', 'ORGANIZATION', org.id, null, null, b);
    res.status(201).json({ id: org.id, ...b });
  }),
);

router.patch(
  '/organizations/:id',
  handler(async (req, res) => {
    await requirePermission(req, 'organization:manage');
    const orgId = idParam(req);
    const b = orgBody.partial().parse(req.body);
    const before = await prisma.organizations.findUnique({ where: { id: orgId } });
    if (!before) throw notFound('Organisation');
    await prisma.organizations.update({
      where: { id: orgId },
      data: { name: b.name, org_type: b.orgType, registration_number: b.registrationNumber, contact_email: b.contactEmail, is_active: b.isActive },
    });
    await audit(req, 'ORGANIZATION_UPDATED', 'ORGANIZATION', orgId, null, before, b);
    res.json(await queryOne('SELECT id, name, org_type, registration_number, contact_email::text, is_active FROM organizations WHERE id = $1', [orgId]));
  }),
);

router.get(
  '/organizations/agreements',
  handler(async (_req, res) => {
    res.json(
      await query(`
        SELECT a.id, a.organization_a_id, oa.name AS organization_a_name, a.organization_b_id, ob.name AS organization_b_name,
               a.valid_from, a.valid_to, daterange(a.valid_from, a.valid_to, '[)') @> fn_today() AS in_force
        FROM organization_agreements a
        JOIN organizations oa ON oa.id = a.organization_a_id
        JOIN organizations ob ON ob.id = a.organization_b_id
        ORDER BY in_force DESC, oa.name, ob.name`),
    );
  }),
);

router.post(
  '/organizations/agreements',
  handler(async (req, res) => {
    await requirePermission(req, 'organization:manage');
    const b = z
      .object({ organizationAId: id, organizationBId: id, validFrom: z.string().date(), validTo: z.string().date().nullable().default(null) })
      .refine((x) => x.organizationAId !== x.organizationBId, { path: ['organizationBId'], message: 'Choose two different organisations' })
      .refine((x) => !x.validTo || x.validTo > x.validFrom, { path: ['validTo'], message: 'Must be after the start date' })
      .parse(req.body);
    // Canonical order (a < b) is a table constraint; the exclusion constraint blocks overlaps.
    const row = await queryOne<{ id: number }>(
      `INSERT INTO organization_agreements (organization_a_id, organization_b_id, valid_from, valid_to, created_by)
       VALUES (least($1::int, $2::int), greatest($1::int, $2::int), $3, $4, $5) RETURNING id`,
      [b.organizationAId, b.organizationBId, b.validFrom, b.validTo, currentUser(req).id],
    );
    await audit(req, 'AGREEMENT_CREATED', 'ORGANIZATION_AGREEMENT', row!.id, null, null, b);
    res.status(201).json({ id: row!.id, ...b });
  }),
);

/* ------------------------------------------------------------ facilities ---- */

const facilitySelect = `
  SELECT f.id, f.code, f.name, f.facility_type, f.organization_id, o.name AS organization_name,
         f.region_id, rt.path AS region_path, rt.name AS region_name, f.address_line,
         f.latitude, f.longitude, f.has_cold_chain, f.max_dispatch_radius_km, f.contact_phone, f.is_active, f.is_synthetic
  FROM facilities f
  JOIN organizations o ON o.id = f.organization_id
  JOIN v_region_tree rt ON rt.id = f.region_id`;

// The directory (identity, location, contact) is visible to every signed-in user;
// operational detail (stock, settings) is scope-checked below.
router.get(
  '/facilities',
  handler(async (req, res) => {
    const q = listQuery
      .extend({ type: z.enum(FACILITY_TYPES).optional(), organizationId: id.optional(), regionId: id.optional(), pageSize: z.coerce.number().int().min(1).max(100).default(100) })
      .parse(req.query);
    const user = currentUser(req);
    const base = `
      SELECT x.*, (x.id = ANY($5::int[]) OR $6) AS in_scope FROM (${facilitySelect}) x
      WHERE ($1::text IS NULL OR x.name ILIKE '%' || $1 || '%' OR x.code ILIKE '%' || $1 || '%' OR x.region_path ILIKE '%' || $1 || '%')
        AND ($2::facility_type IS NULL OR x.facility_type = $2)
        AND ($3::int IS NULL OR x.organization_id = $3)
        AND ($4::int IS NULL OR x.region_id IN (SELECT id FROM v_region_tree WHERE id = $4 OR path LIKE (SELECT path FROM v_region_tree WHERE id = $4) || ' › %'))`;
    res.json(
      await paginate(base, [q.search ?? null, q.type ?? null, q.organizationId ?? null, q.regionId ?? null, user.scopeFacilityIds, user.platformScope], q,
        { name: 'name', code: 'code', type: 'facility_type', region: 'region_path', organization: 'organization_name' }, 'code'),
    );
  }),
);

router.get(
  '/facilities/:id',
  handler(async (req, res) => {
    const fid = idParam(req);
    const f = await queryOne(`${facilitySelect} WHERE f.id = $1`, [fid]);
    if (!f) throw notFound('Facility');
    const user = currentUser(req);
    res.json({ ...f, inScope: user.platformScope || user.scopeFacilityIds.includes(fid) });
  }),
);

router.get(
  '/facilities/:id/summary',
  handler(async (req, res) => {
    const fid = idParam(req);
    facilityScope(req, fid);
    const s = await queryOne('SELECT * FROM v_facility_inventory_summary WHERE facility_id = $1', [fid]);
    if (!s) throw notFound('Facility');
    res.json(s);
  }),
);

const facilityBody = z.object({
  organizationId: id,
  regionId: id,
  code: z.string().trim().regex(/^FAC-[0-9]{3,}$/, 'Use the format FAC-000'),
  name: z.string().trim().min(3).max(160),
  facilityType: z.enum(FACILITY_TYPES),
  addressLine: z.string().trim().min(3).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  hasColdChain: z.boolean().default(false),
  maxDispatchRadiusKm: z.number().positive().max(9999).default(100),
  contactPhone: z.string().trim().max(40).optional(),
  isActive: z.boolean().default(true),
});

async function assertCanManageFacilities(req: Parameters<typeof currentUser>[0], organizationId: number) {
  // facility:manage at platform, or for the organisation (checked via any of its facilities).
  if (await hasPermission(currentUser(req).id, 'facility:manage', null)) return;
  const ok = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                    WHERE ur.user_id = $1 AND rp.permission_code = 'facility:manage' AND ur.organization_id = $2) AS ok`,
    [currentUser(req).id, organizationId],
  );
  if (!ok?.ok) throw forbidden('You can only manage facilities of your own organisation');
}

router.post(
  '/facilities',
  handler(async (req, res) => {
    const b = facilityBody.parse(req.body);
    await assertCanManageFacilities(req, b.organizationId);
    const f = await prisma.facilities.create({
      data: {
        organization_id: b.organizationId, region_id: b.regionId, code: b.code, name: b.name, facility_type: b.facilityType,
        address_line: b.addressLine, latitude: b.latitude, longitude: b.longitude, has_cold_chain: b.hasColdChain,
        max_dispatch_radius_km: b.maxDispatchRadiusKm, contact_phone: b.contactPhone, is_active: b.isActive, is_synthetic: false,
      },
    });
    await audit(req, 'FACILITY_CREATED', 'FACILITY', f.id, f.id, null, b);
    res.status(201).json(await queryOne(`${facilitySelect} WHERE f.id = $1`, [f.id]));
  }),
);

router.patch(
  '/facilities/:id',
  handler(async (req, res) => {
    const fid = idParam(req);
    const before = await prisma.facilities.findUnique({ where: { id: fid } });
    if (!before) throw notFound('Facility');
    const b = facilityBody.omit({ organizationId: true }).partial().parse(req.body);
    await assertCanManageFacilities(req, before.organization_id);
    await prisma.facilities.update({
      where: { id: fid },
      data: {
        region_id: b.regionId, code: b.code, name: b.name, facility_type: b.facilityType, address_line: b.addressLine,
        latitude: b.latitude, longitude: b.longitude, has_cold_chain: b.hasColdChain, max_dispatch_radius_km: b.maxDispatchRadiusKm,
        contact_phone: b.contactPhone, is_active: b.isActive,
      },
    });
    await audit(req, 'FACILITY_UPDATED', 'FACILITY', fid, fid, { name: before.name, is_active: before.is_active }, b);
    res.json(await queryOne(`${facilitySelect} WHERE f.id = $1`, [fid]));
  }),
);

/* ------------------------------------------------- stock policy settings ---- */

router.get(
  '/facilities/:id/settings',
  handler(async (req, res) => {
    const fid = idParam(req);
    facilityScope(req, fid);
    const q = listQuery.extend({ pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const base = `
      SELECT s.medicine_id, m.code AS medicine_code, m.name AS medicine_name, fn_strength_label(m.id) AS strength_label,
             s.min_stock_level, s.reorder_threshold, s.safety_stock, s.estimated_daily_consumption, s.estimate_is_simulated,
             d.measured_daily_consumption, d.daily_rate, d.demand_basis, d.possibly_censored, ss.usable, ss.days_of_inventory, ss.stock_status,
             s.updated_at
      FROM facility_medicine_settings s
      JOIN medicines m ON m.id = s.medicine_id
      JOIN v_demand d ON d.facility_id = s.facility_id AND d.medicine_id = s.medicine_id
      JOIN v_shortage_status ss ON ss.facility_id = s.facility_id AND ss.medicine_id = s.medicine_id
      WHERE s.facility_id = $1 AND ($2::text IS NULL OR m.name ILIKE '%' || $2 || '%')`;
    res.json(await paginate(base, [fid, q.search ?? null], q, { medicine: 'medicine_name', status: 'stock_status', days: 'days_of_inventory' }, 'medicine'));
  }),
);

router.put(
  '/facilities/:id/settings/:medicineId',
  handler(async (req, res) => {
    const fid = idParam(req);
    const mid = idParam(req, 'medicineId');
    await requirePermission(req, 'settings:manage', fid);
    const b = z
      .object({
        minStockLevel: z.number().int().min(0),
        reorderThreshold: z.number().int().positive(),
        safetyStock: z.number().int().min(0),
        estimatedDailyConsumption: z.number().min(0).max(1_000_000),
        estimateIsSimulated: z.boolean().default(false),
      })
      .refine((v) => v.minStockLevel <= v.reorderThreshold, { path: ['minStockLevel'], message: 'Must not exceed the reorder threshold' })
      .refine((v) => v.safetyStock <= v.reorderThreshold, { path: ['safetyStock'], message: 'Must not exceed the reorder threshold' })
      .parse(req.body);
    const key = { facility_id_medicine_id: { facility_id: fid, medicine_id: mid } };
    const before = await prisma.facility_medicine_settings.findUnique({ where: key });
    const data = {
      min_stock_level: b.minStockLevel, reorder_threshold: b.reorderThreshold, safety_stock: b.safetyStock,
      estimated_daily_consumption: b.estimatedDailyConsumption, estimate_is_simulated: b.estimateIsSimulated, updated_by: BigInt(currentUser(req).id),
    };
    await prisma.facility_medicine_settings.upsert({ where: key, create: { facility_id: fid, medicine_id: mid, ...data }, update: data });
    await audit(req, before ? 'SETTINGS_UPDATED' : 'SETTINGS_CREATED', 'FACILITY_MEDICINE_SETTINGS', `${fid}:${mid}`, fid,
      before ? { minStockLevel: before.min_stock_level, reorderThreshold: before.reorder_threshold } : null, b);
    res.json(
      await queryOne(
        `SELECT s.*, d.daily_rate, d.demand_basis, ss.usable, ss.stock_status, ss.days_of_inventory
         FROM facility_medicine_settings s
         JOIN v_demand d USING (facility_id, medicine_id)
         JOIN v_shortage_status ss USING (facility_id, medicine_id)
         WHERE s.facility_id = $1 AND s.medicine_id = $2`,
        [fid, mid],
      ),
    );
  }),
);
