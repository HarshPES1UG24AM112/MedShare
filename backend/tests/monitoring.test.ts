import { describe, expect, it } from 'vitest';
import { as, facility, users } from './helpers.js';

describe('monitoring, redistribution, analytics and admin', () => {
  it('shortage list exposes days remaining and labels the demand basis', async () => {
    const res = await (await as(users.admin)).get('/alerts/shortages?severity=CRITICAL&pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const s of res.body.data) {
      expect(s.currentStock).toBeLessThan(s.minStockLevel);
      expect(['MEASURED', 'ESTIMATED_SIMULATED', 'ESTIMATED_CONFIGURED']).toContain(s.demandBasis);
    }
  });

  it('expiry windows only return batches inside the window', async () => {
    const api = await as(users.admin);
    const seven = await api.get('/alerts/expiry?window=7&pageSize=100');
    expect(seven.body.data.every((b: { daysToExpiry: number }) => b.daysToExpiry >= 0 && b.daysToExpiry <= 7)).toBe(true);
    const expired = await api.get('/alerts/expiry?window=expired&pageSize=100');
    expect(expired.body.data.every((b: { daysToExpiry: number }) => b.daysToExpiry < 0)).toBe(true);
    const summary = await api.get('/alerts/expiry/summary');
    expect(summary.body.within30).toBeGreaterThanOrEqual(summary.body.within7);
  });

  it('acknowledging an alert requires scope and changes its status once', async () => {
    const own = await facility('FAC-001');
    const fm = await as(users.fm('FAC-001'));
    const s = (await fm.get('/alerts/shortages?pageSize=50')).body.data.find((x: { alertStatus: string }) => x.alertStatus === 'OPEN');
    expect((await (await as(users.fm('FAC-006'))).post(`/alerts/shortages/${s.alertId}/acknowledge`)).status).toBe(403);
    expect((await fm.post(`/alerts/shortages/${s.alertId}/acknowledge`)).body.status).toBe('ACKNOWLEDGED');
    expect((await fm.post(`/alerts/shortages/${s.alertId}/acknowledge`)).status).toBe(409);
    expect(s.facilityId).toBe(own);
  });

  it('a facility manager updates a stock policy; the shortage trigger re-evaluates it (app-role write path)', async () => {
    const fid = await facility('FAC-001');
    const fm = await as(users.fm('FAC-001'));
    const policy = (await fm.get(`/facilities/${fid}/settings?pageSize=100`)).body.data.find((s: { usable: number }) => s.usable > 50);
    // Raise the thresholds above current stock: the trigger must open a CRITICAL shortage.
    const res = await fm.put(`/facilities/${fid}/settings/${policy.medicineId}`, {
      minStockLevel: policy.usable + 100, reorderThreshold: policy.usable + 200, safetyStock: 10, estimatedDailyConsumption: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.stockStatus).toBe('CRITICAL');
    const shortage = (await fm.get(`/alerts/shortages?medicineId=${policy.medicineId}`)).body.data[0];
    expect(shortage).toMatchObject({ severity: 'CRITICAL', alertStatus: 'OPEN' });
    expect((await fm.put(`/facilities/${fid}/settings/${policy.medicineId}`, { minStockLevel: 500, reorderThreshold: 100, safetyStock: 0, estimatedDailyConsumption: 1 })).status).toBe(422);
    expect((await (await as(users.im('FAC-001'))).put(`/facilities/${fid}/settings/${policy.medicineId}`, { minStockLevel: 1, reorderThreshold: 2, safetyStock: 0, estimatedDailyConsumption: 1 })).status).toBe(403);
  });

  it('recommendation generation needs an organisation or platform role', async () => {
    expect((await (await as(users.fm('FAC-001'))).post('/redistribution/run')).status).toBe(403);
    const res = await (await as(users.org1Admin)).post('/redistribution/run');
    expect(res.status).toBe(200);
    expect(res.body.generated).toBeGreaterThan(0);
  });

  it('accepting a recommendation creates a PENDING transfer (never executes it)', async () => {
    const admin = await as(users.admin);
    const recs = (await admin.get('/redistribution/recommendations?reasonCode=SHORTAGE_COVER&pageSize=100')).body.data;
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.batch.quantityAvailable).toBeGreaterThan(0);
      expect(r.distanceKm).toBeGreaterThanOrEqual(0);
    }
    const rec = recs.find((r: { stale: boolean; crossOrganization: boolean }) => !r.stale && !r.crossOrganization) ?? recs[0];
    const dest = rec.destinationFacility.code as string;
    const accepted = await (await as(users.im(dest))).post(`/redistribution/recommendations/${rec.id}/accept`);
    expect(accepted.status).toBe(201);
    const t = (await (await as(users.im(dest))).get(`/transfers/${accepted.body.transferId}`)).body;
    expect(t).toMatchObject({ status: 'PENDING', recommendationId: rec.id });
    const again = await (await as(users.im(dest))).post(`/redistribution/recommendations/${rec.id}/accept`);
    expect(again.status).toBe(409);
  });

  it('dashboard summary is scoped to the caller', async () => {
    const network = (await (await as(users.admin)).get('/dashboard/summary')).body;
    const own = (await (await as(users.fm('FAC-001'))).get('/dashboard/summary')).body;
    expect(network.totalFacilities).toBe(15);
    expect(own.totalFacilities).toBe(1);
    expect(own.totalInventoryUnits).toBeLessThan(network.totalInventoryUnits);
  });

  it('analytics overview returns every section from one snapshot and labels synthetic data', async () => {
    const res = await (await as(users.admin)).get('/analytics/overview?months=6');
    expect(res.status).toBe(200);
    for (const key of ['inventoryDistribution', 'expiryTrend', 'shortageRisk', 'recurringShortages', 'transferStats', 'movementTrend',
      'stockByCategory', 'availabilityByRegion', 'expiryRisk', 'wastage', 'redistribution', 'monthlyConsumption', 'demandBasis']) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.expiryTrend).toHaveLength(12);
    expect(res.body.transferStats).toHaveLength(6);
    expect(res.body.meta).toMatchObject({ synthetic: true });
    const states = res.body.availabilityByRegion.filter((r: { level: string }) => r.level === 'STATE');
    const districts = res.body.availabilityByRegion.filter((r: { level: string }) => r.level === 'DISTRICT');
    // The recursive rollup: the state total equals the sum of its districts.
    expect(states[0].usableUnits).toBe(districts.reduce((s: number, d: { usableUnits: number }) => s + d.usableUnits, 0));
  });

  it('reconciliation over HTTP reports zero discrepancies after all tests', async () => {
    const res = await (await as(users.auditor)).post('/admin/reconciliation');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, isolation: 'REPEATABLE READ' });
  });

  it('admin jobs require the system administrator role', async () => {
    expect((await (await as(users.org1Admin)).post('/admin/jobs/expiry-alerts')).status).toBe(403);
    const ok = await (await as(users.admin)).post('/admin/jobs/expiry-alerts');
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('newAlerts');
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await (await as(users.admin)).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
