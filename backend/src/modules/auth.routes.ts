import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, currentUser, hashPassword, loadUser, signToken, verifyPassword, type AuthUser } from '../auth/auth.js';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { prisma } from '../db/prisma.js';
import { audit } from '../http/audit.js';
import { ApiError } from '../http/errors.js';
import { handler } from '../http/helpers.js';

export const router = Router();

export const passwordPolicy = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[0-9]/, 'Include a number');

// A real bcrypt hash (same cost as stored ones) to equalise timing when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('medshare-timing-equaliser', 12);

/** User + effective permissions, as returned by /auth/me and /auth/login. */
export async function describeUser(user: AuthUser) {
  const perms = await query<{ facilityId: number; permissions: string[] }>(
    `WITH g AS (
        SELECT fu.role_id, fu.facility_id, NULL::integer AS org_id, false AS platform FROM facility_users fu WHERE fu.user_id = $1
        UNION ALL
        SELECT ur.role_id, NULL, ur.organization_id, ur.organization_id IS NULL FROM user_roles ur WHERE ur.user_id = $1)
     SELECT f.id AS facility_id, array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code) AS permissions
     FROM facilities f
     JOIN g ON g.facility_id = f.id OR g.org_id = f.organization_id OR g.platform
     JOIN role_permissions rp ON rp.role_id = g.role_id
     WHERE f.id = ANY($2::int[])
     GROUP BY f.id`,
    [user.id, user.scopeFacilityIds],
  );
  const anywhere = await query<{ code: string }>(
    `SELECT DISTINCT rp.permission_code AS code FROM role_permissions rp
     WHERE rp.role_id IN (SELECT role_id FROM facility_users WHERE user_id = $1 UNION SELECT role_id FROM user_roles WHERE user_id = $1)
     ORDER BY 1`,
    [user.id],
  );
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    facilities: user.facilities,
    scopeFacilityIds: user.scopeFacilityIds,
    platformScope: user.platformScope,
    permissions: anywhere.map((p) => p.code),
    facilityPermissions: Object.fromEntries(perms.map((p) => [p.facilityId, p.permissions])),
  };
}

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in a minute.' } }),
});

router.post(
  '/auth/login',
  loginLimiter,
  handler(async (req, res) => {
    const body = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) }).parse(req.body);
    const row = await prisma.users.findUnique({ where: { email: body.email.toLowerCase() } });
    // citext makes the lookup case-insensitive; compare even when absent to equalise timing.
    const ok = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok || !row.is_active) {
      await audit(req, 'USER_LOGIN_FAILED', 'AUTH', null, null, null, { email: body.email.toLowerCase() });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    const userId = Number(row.id);
    await prisma.users.update({ where: { id: row.id }, data: { last_login_at: new Date() } });
    const user = (await loadUser(userId))!;
    req.user = user;
    await audit(req, 'USER_LOGIN', 'AUTH', userId);
    res.json({ accessToken: signToken(userId), tokenType: 'Bearer', expiresIn: config.JWT_EXPIRES_IN, user: await describeUser(user) });
  }),
);

router.get(
  '/auth/me',
  authenticate,
  handler(async (req, res) => {
    res.json(await describeUser(currentUser(req)));
  }),
);

router.post(
  '/auth/change-password',
  authenticate,
  handler(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: passwordPolicy })
      .refine((b) => b.currentPassword !== b.newPassword, { path: ['newPassword'], message: 'Must differ from the current password' })
      .parse(req.body);
    const user = currentUser(req);
    const row = await queryOne<{ passwordHash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row || !(await verifyPassword(body.currentPassword, row.passwordHash))) {
      throw new ApiError(422, 'INVALID_CREDENTIALS', 'Current password is incorrect', { currentPassword: ['Incorrect password'] });
    }
    await prisma.users.update({ where: { id: BigInt(user.id) }, data: { password_hash: await hashPassword(body.newPassword) } });
    await audit(req, 'PASSWORD_CHANGED', 'USER', user.id);
    res.status(204).end();
  }),
);
