import type { Me, Permission, Role } from '@/api/types';

/**
 * Client-side permission checks, driven entirely by the server's `Me`.
 * They decide what to SHOW; the database re-checks every write, so each action still handles a 403.
 * Transfer workflow buttons use the server's `allowedActions` instead of anything here.
 */

/** The user holds this permission somewhere (at any facility or through an organisation/platform role). */
export const can = (user: Me | null | undefined, p: Permission) => !!user && user.permissions.includes(p);

/** The user holds this permission at a specific facility. */
export const canAt = (user: Me | null | undefined, p: Permission, facilityId: number | undefined) =>
  !!user && facilityId !== undefined && (user.facilityPermissions[String(facilityId)] ?? []).includes(p);

/** Facility ids where the user holds a permission, in scope order. */
export const facilitiesWith = (user: Me | null | undefined, p: Permission): number[] =>
  user ? user.scopeFacilityIds.filter((id) => canAt(user, p, id)) : [];

/** Every role the user holds, organisation/platform and facility roles together. */
export function rolesOf(user: Me | null | undefined): Role[] {
  if (!user) return [];
  const set = new Set<Role>([...user.roles.map((r) => r.role), ...user.facilities.map((f) => f.role)]);
  return [...set];
}

export const hasRole = (user: Me | null | undefined, ...roles: Role[]) => rolesOf(user).some((r) => roles.includes(r));

/** "Run engine" regenerates network recommendations: organisation or platform administrators only. */
export const canRunEngine = (user: Me | null | undefined) => hasRole(user, 'ORG_ADMIN', 'SYSTEM_ADMIN') && can(user, 'recommendation:manage');
