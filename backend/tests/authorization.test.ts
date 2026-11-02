import { describe, expect, it } from 'vitest';
import { as, facility, firstManufacturer, isoDate, medicineId, uniq, users } from './helpers.js';

describe('authorisation and facility scoping', () => {
  it('rejects inventory reads for a facility outside the caller scope', async () => {
    const res = await (await as(users.fm('FAC-001'))).get(`/inventory?facilityId=${await facility('FAC-007')}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('without a facility filter, a facility manager only sees their own facility', async () => {
    const res = await (await as(users.fm('FAC-001'))).get('/inventory?pageSize=100');
    const own = await facility('FAC-001');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r: { facilityId: number }) => r.facilityId === own)).toBe(true);
  });

  it('an organisation admin sees every facility of their organisation and no other', async () => {
    const me = await (await as(users.org2Admin)).get('/auth/me');
    const codes = me.body.scopeFacilityIds.length;
    expect(codes).toBe(3); // Kaveri Hospitals Trust has three facilities
    const other = await (await as(users.org2Admin)).get(`/inventory?facilityId=${await facility('FAC-001')}`);
    expect(other.status).toBe(403);
  });

  it('the facility directory is visible to every signed-in user', async () => {
    const res = await (await as(users.im('FAC-003'))).get('/facilities');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(15);
    expect(res.body.data.filter((f: { inScope: boolean }) => f.inScope)).toHaveLength(1);
  });

  it('an auditor can read but cannot change stock (enforced inside the database)', async () => {
    const auditor = await as(users.auditor);
    expect((await auditor.get('/inventory?pageSize=1')).status).toBe(200);
    const res = await auditor.post('/inventory/receipts', {
      facilityId: await facility('FAC-001'), medicineId: await medicineId('MED-0001'), manufacturerId: await firstManufacturer(),
      batchNumber: uniq('AUD'), manufactureDate: isoDate(-30), expiryDate: isoDate(300), unitCost: 1, quantity: 10,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('staff of one facility cannot dispense from another facility', async () => {
    const row = (await (await as(users.fm('FAC-001'))).get('/inventory?pageSize=1&expiryBucket=HEALTHY')).body.data[0];
    const res = await (await as(users.im('FAC-002'))).post(`/inventory/${row.inventoryId}/dispense`, { quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('audit logs are restricted to audit:read holders', async () => {
    expect((await (await as(users.im('FAC-001'))).get('/audit-logs')).status).toBe(403);
    expect((await (await as(users.auditor)).get('/audit-logs?pageSize=1')).status).toBe(200);
  });

  it('an organisation admin cannot grant platform roles or manage other organisations', async () => {
    const org1 = await as(users.org1Admin);
    const res = await org1.post('/users', {
      email: `${uniq('x').toLowerCase()}@medshare.health`, fullName: 'Should Fail', password: 'Password1234',
      roles: [{ role: 'SYSTEM_ADMIN', organizationId: null }],
    });
    expect(res.status).toBe(403);
    const crossOrg = await org1.post('/users', {
      email: `${uniq('y').toLowerCase()}@medshare.health`, fullName: 'Should Fail', password: 'Password1234',
      facilities: [{ facilityId: await facility('FAC-006'), role: 'INVENTORY_MANAGER' }],
    });
    expect(crossOrg.status).toBe(403);
    const own = await org1.post('/users', {
      email: `${uniq('z').toLowerCase()}@medshare.health`, fullName: 'New Pharmacist', password: 'Password1234',
      facilities: [{ facilityId: await facility('FAC-003'), role: 'INVENTORY_MANAGER' }],
    });
    expect(own.status).toBe(201);
    expect(own.body.facilities[0]).toMatchObject({ facilityCode: 'FAC-003', role: 'INVENTORY_MANAGER' });
  });

  it('only system administrators can recall a batch', async () => {
    const batch = (await (await as(users.admin)).get('/batches?pageSize=1&status=ACTIVE&onHandOnly=true')).body.data[0];
    expect((await (await as(users.fm('FAC-001'))).post(`/batches/${batch.id}/status`, { status: 'RECALLED', reason: 'test' })).status).toBe(403);
  });
});
