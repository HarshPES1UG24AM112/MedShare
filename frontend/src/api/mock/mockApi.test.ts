import { beforeEach, describe, expect, it } from 'vitest';
import { tokenStore } from '@/auth/tokenStore';
import { ApiError } from '../client';
import { mockApi } from './mockApi';

/**
 * These tests pin the stock-accounting behaviour the UI relies on, so the same
 * expectations can be checked against Agent 1's backend during integration.
 */
const signInAs = (userId: string) => tokenStore.set(`mock.${userId}`);

async function firstTransferableBatch(excludeFacility: string) {
  const { data } = await mockApi.inventory.batches({ pageSize: 100, status: 'OK' });
  const b = data.find((x) => x.facility.id !== excludeFacility && x.quantityAvailable >= 50);
  if (!b) throw new Error('fixture: no transferable batch');
  return b;
}

describe('mock auth', () => {
  it('rejects bad credentials with 401', async () => {
    await expect(mockApi.auth.login({ email: 'admin@medshare.health', password: 'nope' })).rejects.toMatchObject({ status: 401 });
  });
  it('requires a token for protected calls', async () => {
    tokenStore.clear();
    await expect(mockApi.dashboard.summary({})).rejects.toBeInstanceOf(ApiError);
  });
});

describe('transfer lifecycle', () => {
  beforeEach(() => signInAs('usr-001')); // admin

  it('reserves on request, deducts on dispatch, and adds stock at the destination on receipt', async () => {
    const dest = 'fac-004';
    const batch = await firstTransferableBatch(dest);
    const qty = 10;

    const t = await mockApi.transfers.create({ batchId: batch.id, destinationFacilityId: dest, quantity: qty });
    expect(t.status).toBe('PENDING');

    const afterRequest = (await mockApi.inventory.batches({ pageSize: 100, search: batch.batchNumber })).data.find((b) => b.id === batch.id)!;
    expect(afterRequest.quantityAvailable).toBe(batch.quantityAvailable - qty);
    expect(afterRequest.quantityReserved).toBe(batch.quantityReserved + qty);

    await mockApi.transfers.act(t.id, 'approve');
    await mockApi.transfers.act(t.id, 'dispatch');
    const afterDispatch = (await mockApi.inventory.batches({ pageSize: 100, search: batch.batchNumber })).data.find((b) => b.id === batch.id)!;
    expect(afterDispatch.quantityReserved).toBe(batch.quantityReserved);

    const received = await mockApi.transfers.act(t.id, 'receive');
    expect(received.status).toBe('RECEIVED');
    expect(received.history.map((h) => h.status)).toEqual(['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED']);

    const atDest = (await mockApi.inventory.batches({ facilityId: dest, pageSize: 100, search: batch.batchNumber })).data;
    expect(atDest.reduce((s, b) => s + b.quantityAvailable, 0)).toBeGreaterThanOrEqual(qty);
  });

  it('releases the reservation when a transfer is rejected', async () => {
    const batch = await firstTransferableBatch('fac-006');
    const t = await mockApi.transfers.create({ batchId: batch.id, destinationFacilityId: 'fac-006', quantity: 5 });
    await expect(mockApi.transfers.act(t.id, 'reject')).rejects.toMatchObject({ status: 422 }); // reason required
    await mockApi.transfers.act(t.id, 'reject', { reason: 'Committed to outreach camp' });
    const after = (await mockApi.inventory.batches({ pageSize: 100, search: batch.batchNumber })).data.find((b) => b.id === batch.id)!;
    expect(after.quantityAvailable).toBe(batch.quantityAvailable);
  });

  it('refuses quantities above available stock and invalid state transitions', async () => {
    const batch = await firstTransferableBatch('fac-007');
    await expect(
      mockApi.transfers.create({ batchId: batch.id, destinationFacilityId: 'fac-007', quantity: batch.quantityAvailable + 1 }),
    ).rejects.toMatchObject({ status: 422, code: 'INSUFFICIENT_STOCK' });
    const t = await mockApi.transfers.create({ batchId: batch.id, destinationFacilityId: 'fac-007', quantity: 1 });
    await expect(mockApi.transfers.act(t.id, 'receive')).rejects.toMatchObject({ status: 409 });
  });
});

describe('role enforcement', () => {
  it('forbids viewers from requesting transfers and non-admins from audit logs', async () => {
    signInAs('usr-004'); // viewer
    const { data } = await mockApi.inventory.batches({ pageSize: 1, status: 'OK' });
    await expect(mockApi.transfers.create({ batchId: data[0].id, destinationFacilityId: 'fac-003', quantity: 1 })).rejects.toMatchObject({ status: 403 });
    signInAs('usr-003'); // pharmacist
    await expect(mockApi.audit.list({})).rejects.toMatchObject({ status: 403 });
  });
});

describe('derived alerts', () => {
  beforeEach(() => signInAs('usr-001'));

  it('classifies shortages consistently with thresholds', async () => {
    const { data } = await mockApi.alerts.shortages({ pageSize: 100 });
    expect(data.length).toBeGreaterThan(0);
    for (const s of data) {
      expect(s.currentStock).toBeLessThan(s.reorderThreshold);
      expect(s.severity).toBe(s.currentStock < s.criticalThreshold ? 'CRITICAL' : 'LOW');
    }
  });

  it('returns only batches inside the requested expiry window', async () => {
    const { data } = await mockApi.alerts.expiry({ window: '7', pageSize: 100 });
    for (const b of data) expect(b.daysToExpiry).toBeGreaterThanOrEqual(0), expect(b.daysToExpiry).toBeLessThanOrEqual(7);
    const expired = await mockApi.alerts.expiry({ window: 'expired', pageSize: 100 });
    for (const b of expired.data) expect(b.daysToExpiry).toBeLessThan(0);
  });
});
