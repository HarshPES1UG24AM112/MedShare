import { describe, expect, it } from 'vitest';
import { as, facility, newKey, receiveBatch, users } from './helpers.js';

const request = async (dest: string, batchId: number, quantity: number, key?: string) =>
  (await as(users.im(dest))).post(
    '/transfers',
    { sourceFacilityId: await facility('FAC-001'), destinationFacilityId: await facility(dest), items: [{ batchId, quantity }], notes: 'test' },
    key,
  );

describe('transfer workflow over HTTP', () => {
  it('runs request → approve (reserve) → dispatch → receive with correct balances and allowed actions', async () => {
    const { inventoryId, batchId } = await receiveBatch('FAC-001', 300);
    const created = await request('FAC-002', batchId, 120);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'PENDING', requiredStages: ['SOURCE_FACILITY'] });
    const id = created.body.id;

    const fm = await as(users.fm('FAC-001'));
    const asApprover = (await fm.get(`/transfers/${id}`)).body;
    expect(asApprover.allowedActions.approve).toEqual(['SOURCE_FACILITY']);
    const asRequester = (await (await as(users.im('FAC-002'))).get(`/transfers/${id}`)).body;
    expect(asRequester.allowedActions).toMatchObject({ approve: [], cancel: true, dispatch: false });

    const approved = await fm.post(`/transfers/${id}/approve`, { comment: 'ok' });
    expect(approved.body.status).toBe('APPROVED');
    let src = (await fm.get(`/inventory/${inventoryId}`)).body;
    expect(src).toMatchObject({ qtyAvailable: 180, qtyReserved: 120 });

    const dispatched = await (await as(users.im('FAC-001'))).post(`/transfers/${id}/dispatch`, { note: 'Van 7' });
    expect(dispatched.body.status).toBe('DISPATCHED');
    src = (await fm.get(`/inventory/${inventoryId}`)).body;
    expect(src).toMatchObject({ qtyAvailable: 180, qtyReserved: 0 });

    const itemId = dispatched.body.items[0].id;
    const received = await (await as(users.im('FAC-002'))).post(`/transfers/${id}/receive`, { lines: [{ itemId, received: 118, damaged: 2 }] });
    expect(received.body.status).toBe('RECEIVED');
    expect(received.body.items[0]).toMatchObject({ quantityReceived: 118, quantityDamagedInTransit: 2 });
    expect(received.body.timeline.map((e: { toStatus: string }) => e.toStatus)).toEqual(['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED']);
    expect(received.body.timeline[3].fromStatus).toBe('DISPATCHED');

    const destRows = (await (await as(users.im('FAC-002'))).get(`/inventory?batchId=${batchId}`)).body.data;
    expect(destRows[0]).toMatchObject({ qtyAvailable: 118, qtyDamaged: 2 });

    const audit = await (await as(users.admin)).get(`/audit-logs?entityType=TRANSFER&entityId=${id}&pageSize=20`);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_DISPATCHED', 'TRANSFER_RECEIVED']),
    );
  });

  it('two concurrent approvals for the same stock: one succeeds, one gets INSUFFICIENT_STOCK', async () => {
    const { inventoryId, batchId } = await receiveBatch('FAC-001', 100);
    const a = (await request('FAC-002', batchId, 70)).body.id;
    const b = (await request('FAC-004', batchId, 60)).body.id;
    const fm = await as(users.fm('FAC-001'));
    const results = await Promise.all([fm.post(`/transfers/${a}/approve`), fm.post(`/transfers/${b}/approve`)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 422]);
    expect(results.find((r) => r.status === 422)!.body.error.code).toBe('INSUFFICIENT_STOCK');
    const src = (await fm.get(`/inventory/${inventoryId}`)).body;
    expect(src.qtyReserved).toBeLessThanOrEqual(100);
    expect(src.qtyAvailable + src.qtyReserved).toBe(100);
  });

  it('idempotency: the same key returns the same transfer; a different body with that key is rejected', async () => {
    const { batchId } = await receiveBatch('FAC-001', 50);
    const key = newKey();
    const first = await request('FAC-002', batchId, 10, key);
    const retry = await request('FAC-002', batchId, 10, key);
    expect(first.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    const misuse = await request('FAC-002', batchId, 11, key);
    expect(misuse.status).toBe(422);
    expect(misuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a retried dispatch with the same key does not dispatch twice', async () => {
    const { batchId } = await receiveBatch('FAC-001', 50);
    const id = (await request('FAC-002', batchId, 10)).body.id;
    await (await as(users.fm('FAC-001'))).post(`/transfers/${id}/approve`);
    const im = await as(users.im('FAC-001'));
    const key = newKey();
    const [d1, d2] = await Promise.all([im.post(`/transfers/${id}/dispatch`, {}, key), im.post(`/transfers/${id}/dispatch`, {}, key)]);
    expect([d1.status, d2.status]).toEqual([200, 200]);
    const moves = await im.get(`/inventory/movements?batchId=${batchId}&type=TRANSFER_OUT`);
    expect(moves.body.meta.total).toBe(1);
  });

  it('segregation of duties: requester cannot approve; inventory manager cannot approve', async () => {
    const { batchId } = await receiveBatch('FAC-001', 50);
    // Push transfer requested by the source facility manager…
    const pushed = await (await as(users.fm('FAC-001'))).post('/transfers', {
      sourceFacilityId: await facility('FAC-001'), destinationFacilityId: await facility('FAC-002'), items: [{ batchId, quantity: 5 }],
    });
    const self = await (await as(users.fm('FAC-001'))).post(`/transfers/${pushed.body.id}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_APPROVAL');
    const im = await (await as(users.im('FAC-001'))).post(`/transfers/${pushed.body.id}/approve`);
    expect(im.status).toBe(403);
  });

  it('expired or near-expiry batches cannot be transferred', async () => {
    const { batchId } = await receiveBatch('FAC-001', 50, { expiryDays: 5 });
    const res = await request('FAC-002', batchId, 5);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BATCH_NOT_ELIGIBLE');
  });

  it('a recall after approval blocks dispatch; cancelling releases the reservation', async () => {
    const { inventoryId, batchId } = await receiveBatch('FAC-001', 80);
    const id = (await request('FAC-002', batchId, 30)).body.id;
    const fm = await as(users.fm('FAC-001'));
    await fm.post(`/transfers/${id}/approve`);
    await (await as(users.admin)).post(`/batches/${batchId}/status`, { status: 'RECALLED', reason: 'Manufacturer recall (test)' });
    const dispatch = await (await as(users.im('FAC-001'))).post(`/transfers/${id}/dispatch`);
    expect(dispatch.status).toBe(409);
    expect(dispatch.body.error.code).toBe('BATCH_RECALLED');
    const cancelled = await (await as(users.im('FAC-002'))).post(`/transfers/${id}/cancel`, { reason: 'Batch recalled' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await fm.get(`/inventory/${inventoryId}`)).body).toMatchObject({ qtyAvailable: 80, qtyReserved: 0 });
  });

  it('rejects invalid state transitions with 409', async () => {
    const { batchId } = await receiveBatch('FAC-001', 20);
    const id = (await request('FAC-002', batchId, 5)).body.id;
    const res = await (await as(users.im('FAC-001'))).post(`/transfers/${id}/dispatch`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('cross-organisation transfers need the source organisation stage', async () => {
    const { batchId } = await receiveBatch('FAC-001', 60);
    // FAC-014 (Arogya, org 5) has an agreement with org 1.
    const res = await (await as(users.im('FAC-014'))).post('/transfers', {
      sourceFacilityId: await facility('FAC-001'), destinationFacilityId: await facility('FAC-014'), items: [{ batchId, quantity: 10 }],
    });
    expect(res.body.requiredStages).toEqual(['SOURCE_FACILITY', 'SOURCE_ORGANIZATION']);
    const afterFacility = await (await as(users.fm('FAC-001'))).post(`/transfers/${res.body.id}/approve`);
    expect(afterFacility.body.status).toBe('PENDING');
    const afterOrg = await (await as(users.org1Admin)).post(`/transfers/${res.body.id}/approve`, { stage: 'SOURCE_ORGANIZATION' });
    expect(afterOrg.body.status).toBe('APPROVED');
  });

  it('sourcing options list only eligible partner batches for a destination the caller may request for', async () => {
    const { batchId } = await receiveBatch('FAC-001', 90);
    await receiveBatch('FAC-001', 40, { expiryDays: 5 }); // too close to expiry: must not be offered
    const api = await as(users.im('FAC-002'));
    const med = (await api.get('/medicines?search=MED-0001')).body.data[0].id;
    const res = await api.get(`/medicines/${med}/sources?destinationFacilityId=${await facility('FAC-002')}`);
    expect(res.status).toBe(200);
    expect(res.body.some((s: { batchId: number }) => s.batchId === batchId)).toBe(true);
    for (const s of res.body) {
      expect(s.facility.code).not.toBe('FAC-002');
      expect(s.daysToExpiry).toBeGreaterThanOrEqual(14);
      expect(s.qtyAvailable).toBeGreaterThan(0);
    }
    const sorted = [...res.body].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    expect(res.body.map((s: { batchId: number }) => s.batchId)).toEqual(sorted.map((s) => s.batchId)); // FEFO
    // Cannot query sourcing for a destination outside your own facilities.
    expect((await api.get(`/medicines/${med}/sources?destinationFacilityId=${await facility('FAC-007')}`)).status).toBe(403);
  });

  it('lists transfers scoped to the caller with direction filtering', async () => {
    const api = await as(users.im('FAC-002'));
    const incoming = await api.get(`/transfers?facilityId=${await facility('FAC-002')}&direction=incoming&pageSize=100`);
    expect(incoming.status).toBe(200);
    expect(incoming.body.data.every((t: { destinationFacility: { code: string } }) => t.destinationFacility.code === 'FAC-002')).toBe(true);
  });
});

describe('"needs my action" (actionable=true)', () => {
  const ids = async (email: string, extra = '') =>
    ((await (await as(email)).get(`/transfers?actionable=true&pageSize=100${extra}`)).body.data as { id: number }[]).map((t) => t.id);

  it('never offers requesters their own pending transfer to approve', async () => {
    const { batchId } = await receiveBatch('FAC-001', 30);
    // The FAC-001 manager requests a push out of their own facility.
    const own = await (await as(users.fm('FAC-001'))).post('/transfers', {
      sourceFacilityId: await facility('FAC-001'), destinationFacilityId: await facility('FAC-002'), items: [{ batchId, quantity: 5 }],
    });
    expect(own.status).toBe(201);
    expect(own.body.allowedActions.approve).toEqual([]);
    expect(await ids(users.fm('FAC-001'))).not.toContain(own.body.id);
  });

  it('lists a cross-organisation transfer for the organisation admin only after the facility stage', async () => {
    const { batchId } = await receiveBatch('FAC-001', 40);
    const t = await (await as(users.im('FAC-014'))).post('/transfers', {
      sourceFacilityId: await facility('FAC-001'), destinationFacilityId: await facility('FAC-014'), items: [{ batchId, quantity: 6 }],
    });
    expect(await ids(users.fm('FAC-001'))).toContain(t.body.id);
    expect(await ids(users.org1Admin)).toContain(t.body.id); // organisation stage is open in parallel
    await (await as(users.fm('FAC-001'))).post(`/transfers/${t.body.id}/approve`);
    expect(await ids(users.fm('FAC-001'))).not.toContain(t.body.id); // facility stage decided
    expect(await ids(users.org1Admin)).toContain(t.body.id);
    await (await as(users.org1Admin)).post(`/transfers/${t.body.id}/approve`, { stage: 'SOURCE_ORGANIZATION' });
    expect(await ids(users.org1Admin)).not.toContain(t.body.id);
    expect(await ids(users.fm('FAC-001'))).toContain(t.body.id); // now APPROVED: awaiting dispatch at FAC-001
  });
});
