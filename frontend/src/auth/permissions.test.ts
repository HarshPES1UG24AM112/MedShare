import { describe, expect, it } from 'vitest';
import type { Transfer, TransferStatus, User } from '@/api/types';
import { can, canWriteAt, transferActionsFor } from './permissions';

const user = (role: User['role'], facilityId: string | null = 'fac-A', id = 'u1'): User => ({ id, name: 'Test', email: 't@x', role, facilityId });

const transfer = (status: TransferStatus, requestedBy = 'u-req'): Transfer => ({
  id: 't1',
  code: 'TRF-1',
  status,
  medicine: { id: 'm', name: 'M', strength: '1', unit: 'tab' },
  batch: { id: 'b', batchNumber: 'B1', expiryDate: '2030-01-01' },
  sourceFacility: { id: 'fac-A', name: 'A', code: 'A' },
  destinationFacility: { id: 'fac-B', name: 'B', code: 'B' },
  quantity: 10,
  requestedBy: { id: requestedBy, name: 'R' },
  createdAt: '',
  updatedAt: '',
  history: [],
});

describe('can', () => {
  it('restricts audit and facility switching to admins', () => {
    expect(can(user('ADMIN', null), 'audit:view')).toBe(true);
    expect(can(user('FACILITY_MANAGER'), 'audit:view')).toBe(false);
    expect(can(user('PHARMACIST'), 'facility:switch')).toBe(false);
  });
  it('gives viewers no write permissions', () => {
    expect(can(user('VIEWER'), 'transfer:request')).toBe(false);
    expect(can(user('VIEWER'), 'inventory:write')).toBe(false);
  });
  it('limits inventory writes to the user facility', () => {
    expect(canWriteAt(user('PHARMACIST', 'fac-A'), 'fac-A')).toBe(true);
    expect(canWriteAt(user('PHARMACIST', 'fac-A'), 'fac-B')).toBe(false);
    expect(canWriteAt(user('ADMIN', null), 'fac-B')).toBe(true);
  });
});

describe('transferActionsFor', () => {
  it('lets the source facility manager approve or reject a pending transfer', () => {
    expect(transferActionsFor(user('FACILITY_MANAGER', 'fac-A'), transfer('PENDING'))).toEqual(['approve', 'reject']);
  });
  it('does not let the destination manager approve', () => {
    expect(transferActionsFor(user('FACILITY_MANAGER', 'fac-B'), transfer('PENDING'))).toEqual([]);
  });
  it('lets source staff dispatch an approved transfer', () => {
    expect(transferActionsFor(user('PHARMACIST', 'fac-A'), transfer('APPROVED'))).toEqual(['dispatch']);
  });
  it('lets destination staff receive a dispatched transfer', () => {
    expect(transferActionsFor(user('PHARMACIST', 'fac-B'), transfer('DISPATCHED'))).toEqual(['receive']);
  });
  it('lets the requester cancel only while pending', () => {
    const me = user('PHARMACIST', 'fac-B', 'u-req');
    expect(transferActionsFor(me, transfer('PENDING', 'u-req'))).toEqual(['cancel']);
    expect(transferActionsFor(me, transfer('APPROVED', 'u-req'))).toEqual([]);
  });
  it('offers nothing on closed transfers or to viewers', () => {
    expect(transferActionsFor(user('ADMIN', null), transfer('RECEIVED'))).toEqual([]);
    expect(transferActionsFor(user('VIEWER', 'fac-A'), transfer('PENDING'))).toEqual([]);
  });
});
