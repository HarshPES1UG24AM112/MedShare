import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';

export const app = createApp();
export const PASSWORD = 'MedShare@2026';
const tokens = new Map<string, string>();

export async function login(email: string): Promise<string> {
  if (tokens.has(email)) return tokens.get(email)!;
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  tokens.set(email, res.body.accessToken);
  return res.body.accessToken;
}

/** Authenticated supertest helpers for a seeded account. */
export async function as(email: string) {
  const token = await login(email);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1${url}`)),
    post: (url: string, body?: object, idemKey?: string) => {
      const r = auth(request(app).post(`/api/v1${url}`)).send(body ?? {});
      return idemKey ? r.set('Idempotency-Key', idemKey) : r;
    },
    patch: (url: string, body: object) => auth(request(app).patch(`/api/v1${url}`)).send(body),
    put: (url: string, body: object) => auth(request(app).put(`/api/v1${url}`)).send(body),
    delete: (url: string, body?: object) => auth(request(app).delete(`/api/v1${url}`)).send(body ?? {}),
  };
}

export const users = {
  admin: 'admin@medshare.health',
  auditor: 'auditor@medshare.health',
  org1Admin: 'org1.admin@medshare.health',
  org2Admin: 'org2.admin@medshare.health',
  fm: (code: string) => `${code.toLowerCase()}.manager@medshare.health`,
  im: (code: string) => `${code.toLowerCase()}.inventory@medshare.health`,
};

let facilityIds: Record<string, number> | null = null;
export async function facility(code: string): Promise<number> {
  if (!facilityIds) {
    const res = await (await as(users.admin)).get('/facilities?pageSize=100');
    facilityIds = Object.fromEntries(res.body.data.map((f: { code: string; id: number }) => [f.code, f.id]));
  }
  return facilityIds![code];
}

export async function medicineId(code: string): Promise<number> {
  const res = await (await as(users.admin)).get(`/medicines?search=${code}`);
  return res.body.data.find((m: { code: string }) => m.code === code).id;
}

export async function firstManufacturer(): Promise<number> {
  return (await (await as(users.admin)).get('/catalogue/manufacturers')).body[0].id;
}

export const uniq = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
export const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Receives a fresh batch through the API and returns { inventoryId, batchId }. */
export async function receiveBatch(facilityCode: string, quantity: number, opts: { medicine?: string; expiryDays?: number } = {}) {
  const api = await as(users.im(facilityCode));
  const res = await api.post('/inventory/receipts', {
    facilityId: await facility(facilityCode),
    medicineId: await medicineId(opts.medicine ?? 'MED-0001'),
    manufacturerId: await firstManufacturer(),
    batchNumber: uniq('TST'),
    manufactureDate: isoDate(-60),
    expiryDate: isoDate(opts.expiryDays ?? 400),
    unitCost: 1.25,
    quantity,
  });
  if (res.status !== 201) throw new Error(`receipt failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { inventoryId: res.body.inventoryId as number, batchId: res.body.batchId as number };
}

export const newKey = () => randomUUID();
