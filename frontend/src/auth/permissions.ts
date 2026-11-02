import type { Role, Transfer, TransferAction, User } from '@/api/types';

/**
 * Client-side permission checks — used ONLY to decide what to show.
 * The backend remains the authority; every action still handles a 403.
 */
export type Permission =
  | 'facility:switch'
  | 'medicine:create'
  | 'inventory:write'
  | 'transfer:request'
  | 'audit:view';

const MATRIX: Record<Role, Permission[]> = {
  ADMIN: ['facility:switch', 'medicine:create', 'inventory:write', 'transfer:request', 'audit:view'],
  FACILITY_MANAGER: ['medicine:create', 'inventory:write', 'transfer:request'],
  PHARMACIST: ['inventory:write', 'transfer:request'],
  VIEWER: [],
};

export const can = (user: User | null | undefined, p: Permission) => !!user && MATRIX[user.role].includes(p);

export const canWriteAt = (user: User | null | undefined, facilityId: string) =>
  !!user && can(user, 'inventory:write') && (user.role === 'ADMIN' || user.facilityId === facilityId);

/** Which transfer workflow actions the user may take right now. */
export function transferActionsFor(user: User | null | undefined, t: Transfer): TransferAction[] {
  if (!user || user.role === 'VIEWER') return [];
  const admin = user.role === 'ADMIN';
  const sourceManager = user.role === 'FACILITY_MANAGER' && user.facilityId === t.sourceFacility.id;
  const atSource = admin || user.facilityId === t.sourceFacility.id;
  const atDest = admin || user.facilityId === t.destinationFacility.id;
  const out: TransferAction[] = [];
  if (t.status === 'PENDING' && (admin || sourceManager)) out.push('approve', 'reject');
  if (t.status === 'APPROVED' && (admin || sourceManager)) out.push('reject');
  if (t.status === 'APPROVED' && atSource) out.push('dispatch');
  if (t.status === 'DISPATCHED' && atDest) out.push('receive');
  if (t.status === 'PENDING' && (admin || t.requestedBy.id === user.id)) out.push('cancel');
  return out;
}
