import { describe, expect, it } from 'vitest';
import type { Me } from '@/api/types';
import { can, canAt, canRunEngine, facilitiesWith, hasRole, rolesOf } from './permissions';

/** Shapes taken from real /auth/me responses for the seeded demo accounts. */
const facilityManager: Me = {
  id: 13,
  email: 'fac-001.manager@medshare.health',
  fullName: 'Kavya Menon (Synthetic)',
  roles: [],
  facilities: [{ facilityId: 3, facilityCode: 'FAC-001', facilityName: 'Bengaluru Central District Hospital', role: 'FACILITY_MANAGER' }],
  scopeFacilityIds: [3],
  platformScope: false,
  permissions: ['inventory:read', 'inventory:write', 'recommendation:manage', 'report:read', 'request:create', 'settings:manage', 'transfer:approve', 'transfer:dispatch', 'transfer:receive', 'transfer:request'],
  facilityPermissions: {
    '3': ['inventory:read', 'inventory:write', 'recommendation:manage', 'report:read', 'request:create', 'settings:manage', 'transfer:approve', 'transfer:dispatch', 'transfer:receive', 'transfer:request'],
  },
};

const sysAdmin: Me = {
  id: 1,
  email: 'admin@medshare.health',
  fullName: 'Asha Raman (Synthetic)',
  roles: [{ role: 'SYSTEM_ADMIN', organizationId: null, organizationName: null }],
  facilities: [],
  scopeFacilityIds: [1, 2, 3],
  platformScope: true,
  permissions: ['audit:read', 'batch:manage', 'catalogue:manage', 'facility:manage', 'inventory:read', 'organization:manage', 'recommendation:manage', 'report:read', 'user:manage'],
  facilityPermissions: {
    '1': ['audit:read', 'inventory:read', 'report:read'],
    '2': ['audit:read', 'inventory:read', 'report:read'],
    '3': ['audit:read', 'inventory:read', 'report:read'],
  },
};

const orgAdmin: Me = {
  ...sysAdmin,
  id: 5,
  roles: [{ role: 'ORG_ADMIN', organizationId: 1, organizationName: 'Deccan Public Health Network (Synthetic)' }],
  permissions: ['audit:read', 'catalogue:manage', 'facility:manage', 'inventory:read', 'recommendation:manage', 'report:read', 'transfer:approve_org', 'user:manage'],
  platformScope: false,
};

describe('can / canAt', () => {
  it('reads permissions from the server, not from a role table', () => {
    expect(can(facilityManager, 'transfer:approve')).toBe(true);
    expect(can(facilityManager, 'audit:read')).toBe(false);
    expect(can(sysAdmin, 'user:manage')).toBe(true);
    expect(can(null, 'inventory:read')).toBe(false);
  });

  it('checks facility-level permissions against facilityPermissions', () => {
    expect(canAt(facilityManager, 'inventory:write', 3)).toBe(true);
    expect(canAt(facilityManager, 'inventory:write', 4)).toBe(false);
    expect(canAt(facilityManager, 'inventory:write', undefined)).toBe(false);
  });

  it('never lets a platform administrator write stock (no inventory:write anywhere)', () => {
    expect(canAt(sysAdmin, 'inventory:write', 1)).toBe(false);
    expect(facilitiesWith(sysAdmin, 'transfer:request')).toEqual([]);
  });

  it('lists the facilities where a permission is held, in scope order', () => {
    expect(facilitiesWith(facilityManager, 'transfer:request')).toEqual([3]);
    expect(facilitiesWith(sysAdmin, 'inventory:read')).toEqual([1, 2, 3]);
  });
});

describe('roles', () => {
  it('merges organisation and facility roles', () => {
    expect(rolesOf(facilityManager)).toEqual(['FACILITY_MANAGER']);
    expect(rolesOf(sysAdmin)).toEqual(['SYSTEM_ADMIN']);
    expect(hasRole(orgAdmin, 'ORG_ADMIN', 'SYSTEM_ADMIN')).toBe(true);
  });

  it('shows "Run engine" only to organisation or platform administrators', () => {
    expect(canRunEngine(sysAdmin)).toBe(true);
    expect(canRunEngine(orgAdmin)).toBe(true);
    // A facility manager has recommendation:manage but is not an org/platform admin.
    expect(canRunEngine(facilityManager)).toBe(false);
  });
});
