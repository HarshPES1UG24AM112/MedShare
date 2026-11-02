/**
 * Authentication (JWT + bcrypt) and authorisation helpers.
 *
 * Authorisation decisions are made by the DATABASE (fn_user_has_permission,
 * fn_user_facility_ids) so the API and the stored procedures share one RBAC
 * definition. Facility ids sent by the client are always checked against them.
 */
import bcrypt from 'bcryptjs';
import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { ApiError, forbidden } from '../http/errors.js';

export interface RoleGrant {
  role: string;
  organizationId: number | null;
  organizationName: string | null;
}
export interface FacilityMembership {
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  role: string;
}
export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  roles: RoleGrant[];
  facilities: FacilityMembership[];
  /** Facilities whose operational detail the user may see. */
  scopeFacilityIds: number[];
  /** Platform-wide read scope (system admin or platform auditor). */
  platformScope: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId: string;
    }
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signToken(userId: number) {
  return jwt.sign({ sub: String(userId) }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
    issuer: 'medshare',
  });
}

/** Loads the full authorisation context. Inactive users get null. */
export async function loadUser(userId: number): Promise<AuthUser | null> {
  const u = await queryOne<{ id: number; email: string; fullName: string; isActive: boolean }>(
    'SELECT id, email::text, full_name, is_active FROM users WHERE id = $1',
    [userId],
  );
  if (!u || !u.isActive) return null;
  const [roles, facilities, scope] = await Promise.all([
    query<RoleGrant>(
      `SELECT r.code AS role, ur.organization_id, o.name AS organization_name
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id LEFT JOIN organizations o ON o.id = ur.organization_id
       WHERE ur.user_id = $1 ORDER BY r.id`,
      [userId],
    ),
    query<FacilityMembership>(
      `SELECT f.id AS facility_id, f.code AS facility_code, f.name AS facility_name, r.code AS role
       FROM facility_users fu JOIN facilities f ON f.id = fu.facility_id JOIN roles r ON r.id = fu.role_id
       WHERE fu.user_id = $1 ORDER BY f.code, r.id`,
      [userId],
    ),
    query<{ id: number }>('SELECT fn_user_facility_ids($1) AS id', [userId]),
  ]);
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    roles,
    facilities,
    scopeFacilityIds: scope.map((s) => s.id).sort((a, b) => a - b),
    platformScope: roles.some((r) => r.organizationId === null && (r.role === 'SYSTEM_ADMIN' || r.role === 'AUDITOR')),
  };
}

/** Requires a valid bearer token and an active account. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header('Authorization');
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), config.JWT_SECRET, { algorithms: ['HS256'], issuer: 'medshare' }) as jwt.JwtPayload;
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
    const user = await loadUser(Number(payload.sub));
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Account is inactive or no longer exists');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required');
  return req.user;
};

/** Permission check delegated to the database RBAC function. */
export async function hasPermission(userId: number, permission: string, facilityId: number | null = null) {
  const row = await queryOne<{ ok: boolean }>('SELECT fn_user_has_permission($1, $2, $3) AS ok', [userId, facilityId, permission]);
  return !!row?.ok;
}

export async function requirePermission(req: Request, permission: string, facilityId: number | null = null) {
  const user = currentUser(req);
  if (!(await hasPermission(user.id, permission, facilityId))) {
    throw forbidden(`Your role does not include ${permission}${facilityId ? ' for this facility' : ''}`);
  }
}

/** True if the user holds the permission anywhere (facility, organisation or platform). */
export async function hasPermissionAnywhere(userId: number, permission: string) {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM facility_users fu JOIN role_permissions rp ON rp.role_id = fu.role_id
                    WHERE fu.user_id = $1 AND rp.permission_code = $2)
         OR EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                    WHERE ur.user_id = $1 AND rp.permission_code = $2) AS ok`,
    [userId, permission],
  );
  return !!row?.ok;
}

export const requirePermissionAnywhere = (permission: string): RequestHandler => async (req, _res, next) => {
  try {
    if (!(await hasPermissionAnywhere(currentUser(req).id, permission))) throw forbidden(`Your role does not include ${permission}`);
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Resolves which facilities a read may cover. A requested facility outside the
 * user's scope is rejected (never silently widened or trusted).
 * Returns null for "all facilities" (platform scope, no filter requested).
 */
export function facilityScope(req: Request, requested?: number): number[] | null {
  const user = currentUser(req);
  if (requested !== undefined) {
    if (!user.platformScope && !user.scopeFacilityIds.includes(requested)) {
      throw forbidden('That facility is outside your access scope');
    }
    return [requested];
  }
  return user.platformScope ? null : user.scopeFacilityIds;
}

export function assertInScope(req: Request, facilityId: number) {
  facilityScope(req, facilityId);
}
