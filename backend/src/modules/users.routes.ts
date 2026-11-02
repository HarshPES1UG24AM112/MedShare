import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, hashPassword, requirePermissionAnywhere } from '../auth/auth.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { prisma } from '../db/prisma.js';
import { audit } from '../http/audit.js';
import { ApiError, forbidden, notFound } from '../http/errors.js';
import { handler, id, idParam, listQuery, paginate } from '../http/helpers.js';
import { passwordPolicy } from './auth.routes.js';

export const router = Router();
router.use('/users', authenticate, requirePermissionAnywhere('user:manage'));

const FACILITY_ROLES = ['FACILITY_MANAGER', 'INVENTORY_MANAGER'] as const;
const ORG_ROLES = ['SYSTEM_ADMIN', 'ORG_ADMIN', 'AUDITOR'] as const;

/** Organisations whose users the actor may manage; null = all (platform). */
async function manageableOrgs(req: Request): Promise<number[] | null> {
  const rows = await query<{ organizationId: number | null }>(
    `SELECT ur.organization_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = $1 AND rp.permission_code = 'user:manage'`,
    [currentUser(req).id],
  );
  if (rows.some((r) => r.organizationId === null)) return null;
  return rows.map((r) => r.organizationId!);
}

async function assertCanGrantFacility(req: Request, facilityId: number) {
  const orgs = await manageableOrgs(req);
  if (orgs === null) return;
  const f = await queryOne<{ organizationId: number }>('SELECT organization_id FROM facilities WHERE id = $1', [facilityId]);
  if (!f) throw notFound('Facility');
  if (!orgs.includes(f.organizationId)) throw forbidden('You can only assign roles at facilities of your organisation');
}

async function assertCanGrantOrgRole(req: Request, role: string, organizationId: number | null) {
  const orgs = await manageableOrgs(req);
  if (orgs === null) return; // platform administrator
  if (role === 'SYSTEM_ADMIN' || organizationId === null) throw forbidden('Only system administrators can grant platform-wide roles');
  if (!orgs.includes(organizationId)) throw forbidden('You can only grant roles within your organisation');
}

async function assertCanManageUser(req: Request, userId: number) {
  const orgs = await manageableOrgs(req);
  if (orgs === null) return;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND organization_id = ANY($2::int[]))
         OR EXISTS (SELECT 1 FROM facility_users fu JOIN facilities f ON f.id = fu.facility_id
                    WHERE fu.user_id = $1 AND f.organization_id = ANY($2::int[]))
         OR NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1)
            AND NOT EXISTS (SELECT 1 FROM facility_users WHERE user_id = $1) AS ok`,
    [userId, orgs],
  );
  if (!row?.ok) throw forbidden('That user belongs to another organisation');
}

async function userDetail(userId: number) {
  const u = await queryOne(
    `SELECT u.id, u.email::text, u.full_name, u.is_active, u.is_synthetic, u.last_login_at, u.created_at,
            coalesce((SELECT json_agg(json_build_object('grantId', ur.id, 'role', r.code, 'organizationId', ur.organization_id, 'organizationName', o.name) ORDER BY r.id)
                      FROM user_roles ur JOIN roles r ON r.id = ur.role_id LEFT JOIN organizations o ON o.id = ur.organization_id
                      WHERE ur.user_id = u.id), '[]') AS roles,
            coalesce((SELECT json_agg(json_build_object('facilityId', f.id, 'facilityCode', f.code, 'facilityName', f.name, 'role', r.code) ORDER BY f.code)
                      FROM facility_users fu JOIN facilities f ON f.id = fu.facility_id JOIN roles r ON r.id = fu.role_id
                      WHERE fu.user_id = u.id), '[]') AS facilities
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!u) throw notFound('User');
  return u;
}

router.get(
  '/users',
  handler(async (req, res) => {
    const q = listQuery
      .extend({
        role: z.string().optional(),
        facilityId: id.optional(),
        organizationId: id.optional(),
        active: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    const orgs = await manageableOrgs(req);
    const params: unknown[] = [orgs, q.search ?? null, q.role ?? null, q.facilityId ?? null, q.organizationId ?? null, q.active ?? null];
    const base = `
      SELECT u.id, u.email::text AS email, u.full_name, u.is_active, u.last_login_at, u.created_at,
             (SELECT array_agg(DISTINCT r.code) FROM (
                 SELECT role_id FROM user_roles WHERE user_id = u.id UNION SELECT role_id FROM facility_users WHERE user_id = u.id) x
              JOIN roles r ON r.id = x.role_id) AS roles,
             (SELECT string_agg(DISTINCT f.code, ', ') FROM facility_users fu JOIN facilities f ON f.id = fu.facility_id WHERE fu.user_id = u.id) AS facility_codes
      FROM users u
      WHERE ($1::int[] IS NULL
             OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.organization_id = ANY($1::int[]))
             OR EXISTS (SELECT 1 FROM facility_users fu JOIN facilities f ON f.id = fu.facility_id
                        WHERE fu.user_id = u.id AND f.organization_id = ANY($1::int[])))
        AND ($2::text IS NULL OR u.full_name ILIKE '%' || $2 || '%' OR u.email::text ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM roles r WHERE r.code = $3 AND (
              r.id IN (SELECT role_id FROM user_roles WHERE user_id = u.id) OR r.id IN (SELECT role_id FROM facility_users WHERE user_id = u.id))))
        AND ($4::int IS NULL OR EXISTS (SELECT 1 FROM facility_users WHERE user_id = u.id AND facility_id = $4))
        AND ($5::int IS NULL OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = u.id AND organization_id = $5)
             OR EXISTS (SELECT 1 FROM facility_users fu JOIN facilities f ON f.id = fu.facility_id WHERE fu.user_id = u.id AND f.organization_id = $5))
        AND ($6::text IS NULL OR u.is_active = ($6 = 'true'))`;
    res.json(await paginate(base, params, q, { name: 'full_name', email: 'email', lastLogin: 'last_login_at', createdAt: 'created_at' }, 'name'));
  }),
);

router.get(
  '/users/:id',
  handler(async (req, res) => {
    const userId = idParam(req);
    await assertCanManageUser(req, userId);
    res.json(await userDetail(userId));
  }),
);

const createUser = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  password: passwordPolicy,
  roles: z.array(z.object({ role: z.enum(ORG_ROLES), organizationId: id.nullable().default(null) })).default([]),
  facilities: z.array(z.object({ facilityId: id, role: z.enum(FACILITY_ROLES) })).default([]),
});

router.post(
  '/users',
  handler(async (req, res) => {
    const body = createUser.parse(req.body);
    for (const g of body.roles) await assertCanGrantOrgRole(req, g.role, g.organizationId);
    for (const f of body.facilities) await assertCanGrantFacility(req, f.facilityId);
    const actor = currentUser(req).id;
    const hash = await hashPassword(body.password);
    const userId = await withTransaction(async (c) => {
      const { rows } = await c.query('INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id', [body.email, hash, body.fullName]);
      const uid = rows[0].id as number;
      for (const g of body.roles) {
        await c.query('INSERT INTO user_roles (user_id, role_id, organization_id, granted_by) SELECT $1, id, $2, $3 FROM roles WHERE code = $4', [uid, g.organizationId, actor, g.role]);
      }
      for (const f of body.facilities) {
        await c.query('INSERT INTO facility_users (user_id, facility_id, role_id, assigned_by) SELECT $1, $2, id, $3 FROM roles WHERE code = $4', [uid, f.facilityId, actor, f.role]);
      }
      await audit(req, 'USER_CREATED', 'USER', uid, body.facilities[0]?.facilityId ?? null, null, { email: body.email, roles: body.roles, facilities: body.facilities }, c);
      return uid;
    });
    res.status(201).json(await userDetail(userId));
  }),
);

router.patch(
  '/users/:id',
  handler(async (req, res) => {
    const userId = idParam(req);
    const body = z.object({ fullName: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional() }).parse(req.body);
    await assertCanManageUser(req, userId);
    if (body.isActive === false && userId === currentUser(req).id) throw new ApiError(422, 'VALIDATION', 'You cannot deactivate your own account');
    const before = await prisma.users.findUnique({ where: { id: BigInt(userId) }, select: { full_name: true, is_active: true } });
    if (!before) throw notFound('User');
    await prisma.users.update({ where: { id: BigInt(userId) }, data: { full_name: body.fullName, is_active: body.isActive } });
    await audit(req, body.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED', 'USER', userId, null, before, body);
    res.json(await userDetail(userId));
  }),
);

router.post(
  '/users/:id/roles',
  handler(async (req, res) => {
    const userId = idParam(req);
    const body = z.object({ role: z.enum(ORG_ROLES), organizationId: id.nullable().default(null) }).parse(req.body);
    await assertCanManageUser(req, userId);
    await assertCanGrantOrgRole(req, body.role, body.organizationId);
    await query('INSERT INTO user_roles (user_id, role_id, organization_id, granted_by) SELECT $1, id, $2, $3 FROM roles WHERE code = $4', [
      userId, body.organizationId, currentUser(req).id, body.role,
    ]);
    await audit(req, 'ROLE_GRANTED', 'USER', userId, null, null, body);
    res.status(201).json(await userDetail(userId));
  }),
);

router.delete(
  '/users/:id/roles/:grantId',
  handler(async (req, res) => {
    const userId = idParam(req);
    const grantId = idParam(req, 'grantId');
    const grant = await queryOne<{ role: string; organizationId: number | null }>(
      'SELECT r.code AS role, ur.organization_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.id = $1 AND ur.user_id = $2',
      [grantId, userId],
    );
    if (!grant) throw notFound('Role grant');
    await assertCanGrantOrgRole(req, grant.role, grant.organizationId);
    if (userId === currentUser(req).id && grant.role === 'SYSTEM_ADMIN') throw new ApiError(422, 'VALIDATION', 'You cannot remove your own system administrator role');
    await query('DELETE FROM user_roles WHERE id = $1', [grantId]);
    await audit(req, 'ROLE_REVOKED', 'USER', userId, null, grant, null);
    res.json(await userDetail(userId));
  }),
);

const facilityRole = z.object({ facilityId: id, role: z.enum(FACILITY_ROLES) });

router.post(
  '/users/:id/facility-roles',
  handler(async (req, res) => {
    const userId = idParam(req);
    const body = facilityRole.parse(req.body);
    await assertCanManageUser(req, userId);
    await assertCanGrantFacility(req, body.facilityId);
    await query('INSERT INTO facility_users (user_id, facility_id, role_id, assigned_by) SELECT $1, $2, id, $3 FROM roles WHERE code = $4 ON CONFLICT DO NOTHING', [
      userId, body.facilityId, currentUser(req).id, body.role,
    ]);
    await audit(req, 'FACILITY_ROLE_ASSIGNED', 'USER', userId, body.facilityId, null, body);
    res.status(201).json(await userDetail(userId));
  }),
);

router.delete(
  '/users/:id/facility-roles',
  handler(async (req, res) => {
    const userId = idParam(req);
    const body = facilityRole.parse(req.body);
    await assertCanGrantFacility(req, body.facilityId);
    const { length } = await query(
      'DELETE FROM facility_users WHERE user_id = $1 AND facility_id = $2 AND role_id = (SELECT id FROM roles WHERE code = $3) RETURNING user_id',
      [userId, body.facilityId, body.role],
    );
    if (!length) throw notFound('Facility role assignment');
    await audit(req, 'FACILITY_ROLE_REMOVED', 'USER', userId, body.facilityId, body, null);
    res.json(await userDetail(userId));
  }),
);
