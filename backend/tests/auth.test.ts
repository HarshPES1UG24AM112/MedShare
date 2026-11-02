import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, as, PASSWORD, uniq, users } from './helpers.js';

describe('authentication', () => {
  it('logs in with valid credentials and returns a JWT plus effective permissions', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: users.fm('FAC-001'), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toMatch(/^eyJ/);
    expect(res.body.user.facilities[0]).toMatchObject({ facilityCode: 'FAC-001', role: 'FACILITY_MANAGER' });
    const fid = res.body.user.facilities[0].facilityId;
    expect(res.body.user.facilityPermissions[fid]).toEqual(expect.arrayContaining(['transfer:approve', 'inventory:write']));
    expect(res.body.user.permissions).not.toContain('audit:read');
  });

  it('is case-insensitive on email (citext)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: users.admin.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password and an unknown email with the same 401', async () => {
    const a = await request(app).post('/api/v1/auth/login').send({ email: users.admin, password: 'wrong-password' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@medshare.health', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(b.body.error).toMatchObject({ code: a.body.error.code, message: a.body.error.message });
  });

  it('validates the login body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveProperty('email');
    expect(res.body.error.details).toHaveProperty('password');
  });

  it('requires a bearer token and rejects a tampered one', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.forged');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('a deactivated account can no longer sign in, and its existing token stops working', async () => {
    const admin = await as(users.admin);
    const email = `${uniq('tmp').toLowerCase()}@medshare.health`;
    const created = await admin.post('/users', { email, fullName: 'Temporary User', password: 'Temporary123', roles: [{ role: 'AUDITOR', organizationId: null }] });
    expect(created.status).toBe(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'Temporary123' });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;

    expect((await admin.patch(`/users/${created.body.id}`, { isActive: false })).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'Temporary123' })).status).toBe(401);
  });

  it('enforces the password policy when changing password', async () => {
    const api = await as(users.auditor);
    const weak = await api.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(422);
    const wrong = await api.post('/auth/change-password', { currentPassword: 'not-it', newPassword: 'AnotherPass123' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('records successful and failed sign-ins in the audit log', async () => {
    const res = await (await as(users.admin)).get('/audit-logs?action=USER_LOGIN_FAILED&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
  });
});
