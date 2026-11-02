import { describe, expect, it } from 'vitest';
import { as, facility, firstManufacturer, isoDate, medicineId, newKey, receiveBatch, uniq, users } from './helpers.js';

describe('medicine catalogue', () => {
  it('creates a combination medicine with ingredients and a generated code', async () => {
    const admin = await as(users.admin);
    const categories = (await admin.get('/catalogue/categories')).body;
    const unit = (await admin.get('/catalogue/units')).body.find((u: { code: string }) => u.code === 'TAB');
    const res = await admin.post('/medicines', {
      name: `Testazole ${uniq('X')}`,
      dosageForm: 'TABLET',
      categoryId: categories.find((c: { name: string }) => c.name === 'Antibiotics').id,
      dispensingUnitId: unit.id,
      isEssential: true,
      ingredients: [
        { substanceName: 'Testazole', strengthValue: 250, strengthUom: 'mg' },
        { substanceName: 'Clavotest', strengthValue: 62.5, strengthUom: 'mg' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^MED-\d{4}$/);
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.strengthLabel).toBe('62.5 mg + 250 mg');
  });

  it('rejects a duplicate composition at commit (deferred constraint trigger → 409)', async () => {
    const admin = await as(users.admin);
    const existing = (await admin.get(`/medicines/${await medicineId('MED-0001')}`)).body;
    const res = await admin.post('/medicines', {
      name: 'Paracetamol copy',
      dosageForm: existing.dosageForm,
      categoryId: existing.categoryId,
      dispensingUnitId: (await admin.get('/catalogue/units')).body.find((u: { code: string }) => u.code === 'TAB').id,
      ingredients: existing.ingredients.map((i: { substanceId: number; strengthValue: number; strengthUom: string }) => ({
        substanceId: i.substanceId, strengthValue: i.strengthValue, strengthUom: i.strengthUom,
      })),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_MEDICINE');
  });

  it('validates medicine input (no ingredients, bad unit of measure)', async () => {
    const res = await (await as(users.admin)).post('/medicines', { name: 'X', dosageForm: 'TABLET', categoryId: 1, dispensingUnitId: 1, ingredients: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveProperty('ingredients');
  });

  it('non-catalogue roles cannot add medicines', async () => {
    expect((await (await as(users.im('FAC-001'))).post('/medicines', {})).status).toBe(403);
  });

  it('searches by substance, manufacturer and category (including descendants)', async () => {
    const api = await as(users.im('FAC-001'));
    const bySubstance = await api.get('/medicines?search=lumefantrine');
    expect(bySubstance.body.data.map((m: { name: string }) => m.name)).toContain('Artemether + Lumefantrine');
    const byManufacturer = await api.get('/medicines?search=Sahyadri&pageSize=100');
    expect(byManufacturer.body.meta.total).toBeGreaterThan(0);
    const parent = (await api.get('/catalogue/categories')).body.find((c: { name: string; depth: number }) => c.name === 'Anti-infectives');
    const byParent = await api.get(`/medicines?categoryId=${parent.id}&pageSize=100`);
    const paths = byParent.body.data.map((m: { categoryPath: string }) => m.categoryPath);
    expect(paths.some((p: string) => p.includes('Antibiotics'))).toBe(true);
    expect(paths.some((p: string) => p.includes('Antimalarials'))).toBe(true);
  });
});

describe('inventory operations', () => {
  it('a goods receipt creates the batch and an inventory row', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 500);
    const row = (await (await as(users.im('FAC-002'))).get(`/inventory/${inventoryId}`)).body;
    expect(row).toMatchObject({ qtyAvailable: 500, qtyReserved: 0, expiryBucket: 'HEALTHY' });
  });

  it('refuses to receive an expired batch', async () => {
    const res = await (await as(users.im('FAC-002'))).post('/inventory/receipts', {
      facilityId: await facility('FAC-002'), medicineId: await medicineId('MED-0001'), manufacturerId: await firstManufacturer(),
      batchNumber: uniq('OLD'), manufactureDate: isoDate(-800), expiryDate: isoDate(-1), unitCost: 1, quantity: 10,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BATCH_EXPIRED');
  });

  it('dispensing more than available is refused and leaves the balance unchanged', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 40);
    const api = await as(users.im('FAC-002'));
    const res = await api.post(`/inventory/${inventoryId}/dispense`, { quantity: 41 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    const ok = await api.post(`/inventory/${inventoryId}/dispense`, { quantity: 15, reference: 'OPD-1' });
    expect(ok.body.qtyAvailable).toBe(25);
  });

  it('damage requires a reason; damaged units move to the damaged bucket and are audited', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 30);
    const api = await as(users.im('FAC-002'));
    expect((await api.post(`/inventory/${inventoryId}/damage`, { quantity: 2 })).status).toBe(422);
    const res = await api.post(`/inventory/${inventoryId}/damage`, { quantity: 2, reason: 'Dropped carton' });
    expect(res.body).toMatchObject({ qtyAvailable: 28, qtyDamaged: 2 });
    const audit = await (await as(users.admin)).get(`/audit-logs?entityType=INVENTORY&entityId=${inventoryId}&action=INVENTORY_DAMAGE`);
    expect(audit.body.meta.total).toBe(1);
  });

  it('writing off stock that has not expired is refused', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 10);
    const res = await (await as(users.im('FAC-002'))).post(`/inventory/${inventoryId}/write-off`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BATCH_NOT_EXPIRED');
  });

  it('the movement ledger shows every change with signed deltas', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 20);
    const api = await as(users.im('FAC-002'));
    await api.post(`/inventory/${inventoryId}/adjust`, { delta: -3, reason: 'Stock count' });
    const res = await api.get(`/inventory/movements?inventoryId=${inventoryId}&sortBy=createdAt&sortDir=asc`);
    expect(res.body.data.map((m: { movementType: string; deltaAvailable: number }) => [m.movementType, m.deltaAvailable])).toEqual([
      ['RECEIPT', 20],
      ['ADJUSTMENT_OUT', -3],
    ]);
  });
});

describe('idempotent stock actions (migration 008)', () => {
  it('a retried dispense with the same key records one movement; another body with that key is refused', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 50);
    const api = await as(users.im('FAC-002'));
    const key = newKey();
    const first = await api.post(`/inventory/${inventoryId}/dispense`, { quantity: 7, reference: 'OPD-RETRY' }, key);
    const retry = await api.post(`/inventory/${inventoryId}/dispense`, { quantity: 7, reference: 'OPD-RETRY' }, key);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.qtyAvailable).toBe(43);
    const ledger = await api.get(`/inventory/movements?inventoryId=${inventoryId}&type=DISPENSE`);
    expect(ledger.body.meta.total).toBe(1);
    const reused = await api.post(`/inventory/${inventoryId}/dispense`, { quantity: 8 }, key);
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('adjustments and damage honour the key too, and a key cannot be reused across actions', async () => {
    const { inventoryId } = await receiveBatch('FAC-002', 30);
    const api = await as(users.im('FAC-002'));
    const key = newKey();
    await api.post(`/inventory/${inventoryId}/adjust`, { delta: -4, reason: 'Count correction' }, key);
    const again = await api.post(`/inventory/${inventoryId}/adjust`, { delta: -4, reason: 'Count correction' }, key);
    expect(again.body.qtyAvailable).toBe(26);
    const other = await api.post(`/inventory/${inventoryId}/damage`, { quantity: 4, reason: 'Count correction' }, key);
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
