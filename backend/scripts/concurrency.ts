/**
 * Multi-connection concurrency tests against real PostgreSQL.
 *
 * Builds a throwaway database (medshare_ccy) from the same migrations, loads a
 * tiny committed fixture, runs every scenario with independent connections
 * (mostly as the least-privilege medshare_app role), and drops the database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DB = 'medshare_ccy';
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../db/migrations');

type PgError = Error & { code?: string; hint?: string; constraint?: string };

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

function check(name: string, cond: boolean, detail = '') {
  if (!cond) throw new Error(`FAILED: ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✓ ${name}`);
}

async function client(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Retry wrapper for transient concurrency errors (deadlock / serialization). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<{ value: T; retries: number }> {
  for (let i = 0; ; i++) {
    try {
      return { value: await fn(), retries: i };
    } catch (e) {
      const code = (e as PgError).code;
      if (i + 1 >= attempts || (code !== '40P01' && code !== '40001')) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
    }
  }
}

async function waitUntilBlocked(observer: pg.Client, pid: number) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await observer.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function buildDatabase(adminUrl: string) {
  const admin = await client(adminUrl);
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();

  const c = await client(withDb(adminUrl, DB));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  await c.query(readFileSync(join(MIGRATIONS, files[0]), 'utf8'));
  for (const f of files.slice(1)) {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE medshare_owner');
    await c.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
    await c.query('COMMIT');
  }

  // Committed fixture: one organisation, a source and 22 destination facilities, users, one medicine.
  await c.query(`
    INSERT INTO regions (code, name) VALUES ('CC', 'Concurrency State');
    INSERT INTO organizations (name, org_type, registration_number) VALUES ('CC Org', 'HOSPITAL_NETWORK', 'CC-1');
    INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude)
    SELECT 1, 1, 'FAC-' || lpad(g::text, 3, '0'), 'CC Facility ' || g, 'HOSPITAL', 'x', 12.9 + g * 0.001, 77.5
    FROM generate_series(1, 23) g;
    INSERT INTO users (email, password_hash, full_name)
    SELECT 'u' || f.id || '.' || r.code || '@cc.test', '$2b$10$concurrencyconcurrencyconc', 'CC ' || r.code || ' ' || f.id
    FROM facilities f CROSS JOIN roles r WHERE r.code IN ('FACILITY_MANAGER', 'INVENTORY_MANAGER');
    INSERT INTO facility_users (user_id, facility_id, role_id)
    SELECT u.id, f.id, r.id FROM users u
    JOIN facilities f ON u.email LIKE 'u' || f.id || '.%'
    JOIN roles r ON u.email LIKE '%.' || r.code || '@cc.test';
    INSERT INTO medicine_categories (name) VALUES ('CC');
    INSERT INTO medicine_units (code, name) VALUES ('TAB', 'tablet');
    INSERT INTO manufacturers (name, license_number) VALUES ('CC Mfr', 'CC-L1');
    INSERT INTO substances (name) VALUES ('Concurrin');
    INSERT INTO medicines (code, name, dosage_form, category_id, dispensing_unit_id) VALUES ('MED-0001', 'Concurrin', 'TABLET', 1, 1);
    INSERT INTO medicine_ingredients VALUES (1, 1, 10, 'mg');`);
  return c;
}

export async function runConcurrencyTests(adminUrl: string) {
  const appPassword = process.env.MEDSHARE_APP_PASSWORD;
  const appUrl = (() => {
    const u = new URL(withDb(adminUrl, DB));
    u.username = 'medshare_app';
    u.password = appPassword ?? '';
    return u.toString();
  })();

  const owner = await buildDatabase(adminUrl);
  const opened: pg.Client[] = [owner];
  const app = async () => {
    const c = await client(appUrl);
    opened.push(c);
    return c;
  };
  const user = async (facility: number, role: 'FACILITY_MANAGER' | 'INVENTORY_MANAGER') =>
    Number((await owner.query(`SELECT id FROM users WHERE email = $1`, [`u${facility}.${role}@cc.test`])).rows[0].id);
  const receive = async (facility: number, batch: string, qty: number) => {
    const im = await user(facility, 'INVENTORY_MANAGER');
    const r = await owner.query(
      `CALL sp_receive_stock($1, $2, 1, 1, $3, current_date - 30, current_date + 365, 1.00, $4, NULL, NULL, NULL)`,
      [im, facility, batch, qty],
    );
    return Number(r.rows[0].p_inventory_id);
  };
  const batchId = async (num: string) => Number((await owner.query(`SELECT id FROM medicine_batches WHERE batch_number = $1`, [num])).rows[0].id);
  const createTransfer = async (dest: number, batch: number, qty: number, key: string | null = null, c: pg.Client = owner) =>
    Number(
      (
        await c.query(`SELECT fn_create_transfer_request($1, 1, $2, $3::jsonb, NULL, NULL, $4) AS id`, [
          await user(dest, 'INVENTORY_MANAGER'),
          dest,
          JSON.stringify([{ batch_id: batch, quantity: qty }]),
          key,
        ])
      ).rows[0].id,
    );
  const balance = async (inv: number) =>
    (await owner.query(`SELECT qty_available, qty_reserved FROM inventory WHERE id = $1`, [inv])).rows[0] as { qty_available: number; qty_reserved: number };
  const fm1 = await user(1, 'FACILITY_MANAGER');
  const im1 = await user(1, 'INVENTORY_MANAGER');

  try {
    // ------------------------------------------------------------------ 1
    console.log('  — two facilities reserve the same stock at the same moment');
    const inv1 = await receive(1, 'CC-RACE-1', 100);
    const b1 = await batchId('CC-RACE-1');
    const tA = await createTransfer(2, b1, 70);
    const tB = await createTransfer(3, b1, 60);
    const s1 = await app();
    const s2 = await app();
    const observer = await app();
    const pid2 = Number((await s2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);

    await s1.query('BEGIN');
    await s1.query(`CALL sp_approve_transfer($1, $2, 'SOURCE_FACILITY', NULL, NULL, NULL)`, [fm1, tA]); // holds row lock
    await s2.query('BEGIN');
    const s2Result = s2
      .query(`CALL sp_approve_transfer($1, $2, 'SOURCE_FACILITY', NULL, NULL, NULL)`, [fm1, tB])
      .then(() => null, (e: PgError) => e);
    check('session 2 blocks on the inventory row lock held by session 1', await waitUntilBlocked(observer, pid2));
    await s1.query('COMMIT');
    const err = await s2Result;
    await s2.query('ROLLBACK');
    check('after session 1 commits, session 2 re-reads 30 available and fails with INSUFFICIENT_STOCK', err?.hint === 'INSUFFICIENT_STOCK', err?.message);
    const bal = await balance(inv1);
    check('reserved (70) never exceeds what was available; available = 30', bal.qty_reserved === 70 && bal.qty_available === 30, JSON.stringify(bal));
    const { rows: tbRows } = await owner.query(`SELECT status, (SELECT count(*) FROM transfer_approvals WHERE transfer_id = $1)::int AS approvals FROM transfer_requests WHERE id = $1`, [tB]);
    check('losing transfer is still PENDING with no approval row (full rollback)', tbRows[0].status === 'PENDING' && tbRows[0].approvals === 0);

    // ------------------------------------------------------------------ 2
    console.log('  — 20 concurrent approvals competing for 100 units (10 each)');
    const inv2 = await receive(1, 'CC-RACE-20', 100);
    const b2 = await batchId('CC-RACE-20');
    const transfers: number[] = [];
    for (let d = 4; d < 24; d++) transfers.push(await createTransfer(d, b2, 10));
    const sessions = await Promise.all(transfers.map(() => app()));
    const results = await Promise.all(
      transfers.map((t, i) =>
        sessions[i].query(`CALL sp_approve_transfer($1, $2, 'SOURCE_FACILITY', NULL, NULL, NULL)`, [fm1, t]).then(
          () => 'ok',
          (e: PgError) => e.hint ?? e.code ?? e.message,
        ),
      ),
    );
    const okCount = results.filter((r) => r === 'ok').length;
    const insufficient = results.filter((r) => r === 'INSUFFICIENT_STOCK').length;
    check(`exactly 10 approvals succeed and 10 fail with INSUFFICIENT_STOCK (got ${okCount} / ${insufficient})`, okCount === 10 && insufficient === 10);
    const bal2 = await balance(inv2);
    check('stock fully reserved, never over-reserved (available 0, reserved 100)', bal2.qty_available === 0 && bal2.qty_reserved === 100, JSON.stringify(bal2));

    // ------------------------------------------------------------------ 3
    console.log('  — duplicate processing: two dispatches of the same transfer');
    const s3 = await app();
    const s4 = await app();
    const [d1, d2] = await Promise.all([
      s3.query(`CALL sp_dispatch_transfer($1, $2, NULL, NULL, NULL)`, [im1, tA]).then(() => 'ok', (e: PgError) => e.hint ?? e.message),
      s4.query(`CALL sp_dispatch_transfer($1, $2, NULL, NULL, NULL)`, [im1, tA]).then(() => 'ok', (e: PgError) => e.hint ?? e.message),
    ]);
    check(`one dispatch wins, the other sees INVALID_STATE (got ${d1} / ${d2})`, [d1, d2].sort().join() === 'INVALID_STATE,ok');
    const outs = Number(
      (await owner.query(`SELECT count(*) FROM inventory_movements mv JOIN transfer_items ti ON ti.id = mv.transfer_item_id WHERE ti.transfer_id = $1 AND mv.movement_type = 'TRANSFER_OUT'`, [tA])).rows[0].count,
    );
    check('exactly one TRANSFER_OUT movement was written', outs === 1);

    // ------------------------------------------------------------------ 4
    console.log('  — idempotency key raced by two concurrent retries');
    const inv4 = await receive(1, 'CC-IDEM-1', 50);
    void inv4;
    const b4 = await batchId('CC-IDEM-1');
    const key = '7b1f6a4e-9c2d-4a51-8f0e-1c2d3e4f5a6b';
    const s5 = await app();
    const s6 = await app();
    const im2 = await user(2, 'INVENTORY_MANAGER');
    const call = (c: pg.Client) =>
      c.query(`SELECT fn_create_transfer_request($1, 1, 2, $2::jsonb, NULL, NULL, $3) AS id`, [im2, JSON.stringify([{ batch_id: b4, quantity: 5 }]), key]).then(
        (r) => `id:${r.rows[0].id}`,
        (e: PgError) => `${e.code}:${e.constraint ?? ''}`,
      );
    const [i1, i2] = await Promise.all([call(s5), call(s6)]);
    const created = Number((await owner.query(`SELECT count(*) FROM idempotency_keys WHERE idem_key = $1`, [key])).rows[0].count);
    const transfersForBatch = Number((await owner.query(`SELECT count(*) FROM transfer_items WHERE batch_id = $1`, [b4])).rows[0].count);
    check(`only one transfer exists for the key (${i1} / ${i2})`, created === 1 && transfersForBatch === 1);
    const retry = await call(s5);
    check('a later retry with the key returns the stored transfer', retry === (i1.startsWith('id:') ? i1 : i2));

    // ------------------------------------------------------------------ 5
    console.log('  — deadlock detection and retry');
    const invX = await receive(2, 'CC-DL-X', 10);
    const invY = await receive(2, 'CC-DL-Y', 10);
    const a = await client(withDb(adminUrl, DB));
    const b = await client(withDb(adminUrl, DB));
    opened.push(a, b);
    await a.query('BEGIN');
    await b.query('BEGIN');
    await a.query('SELECT 1 FROM inventory WHERE id = $1 FOR UPDATE', [invX]);
    await b.query('SELECT 1 FROM inventory WHERE id = $1 FOR UPDATE', [invY]);
    // An aborted transaction keeps its locks until it ends, so the deadlock
    // victim rolls back, which lets the survivor acquire its second lock.
    const lockSecond = (c: pg.Client, id: number) =>
      c.query('SELECT 1 FROM inventory WHERE id = $1 FOR UPDATE', [id]).then(
        () => 'ok',
        async (e: PgError) => {
          await c.query('ROLLBACK');
          return e.code;
        },
      );
    const [ra, rb] = await Promise.all([lockSecond(a, invY), lockSecond(b, invX)]);
    check(`PostgreSQL detects the cycle and aborts one session with 40P01 (got ${ra} / ${rb})`, [ra, rb].sort().join() === '40P01,ok');
    await a.query('ROLLBACK').catch(() => undefined);
    await b.query('ROLLBACK').catch(() => undefined);
    let attempt = 0;
    const retried = await withRetry(async () => {
      attempt++;
      if (attempt === 1) {
        const e = new Error('simulated deadlock') as PgError;
        e.code = '40P01';
        throw e;
      }
      return (await owner.query(`SELECT fn_record_dispense($1, $2, 1) AS id`, [await user(2, 'INVENTORY_MANAGER'), invX])).rows[0].id;
    });
    check(`withRetry() retries a 40P01 and the operation succeeds (retries: ${retried.retries})`, retried.retries === 1 && !!retried.value);

    // ------------------------------------------------------------------ 6
    console.log('  — SERIALIZABLE: a decision based on a stale snapshot is aborted');
    const invS = await receive(1, 'CC-SER-1', 100);
    const sa = await app();
    const sb = await app();
    await sa.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await sb.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const seenA = (await sa.query('SELECT qty_available FROM inventory WHERE id = $1', [invS])).rows[0].qty_available;
    const seenB = (await sb.query('SELECT qty_available FROM inventory WHERE id = $1', [invS])).rows[0].qty_available;
    check(`both sessions read the same snapshot (${seenA} / ${seenB})`, seenA === 100 && seenB === 100);
    await sa.query('SELECT fn_record_dispense($1, $2, 60)', [im1, invS]);
    const sbWrite = sb.query('SELECT fn_record_dispense($1, $2, 60)', [im1, invS]).then(() => 'ok', (e: PgError) => e.code);
    await sa.query('COMMIT');
    const serr = await sbWrite;
    await sb.query('ROLLBACK');
    check(`the second writer is aborted with 40001 serialization_failure (got ${serr})`, serr === '40001');
    const retryResult = await withRetry(() => sb.query('SELECT fn_record_dispense($1, $2, 60)', [im1, invS])).then(
      () => 'ok',
      (e: PgError) => e.hint,
    );
    check('on retry it sees the committed 40 units and is refused with INSUFFICIENT_STOCK', retryResult === 'INSUFFICIENT_STOCK');

    // ------------------------------------------------------------------ 7
    console.log('  — least-privilege application role');
    const ap = await app();
    const denied = async (sql: string, params: unknown[] = []) => ap.query(sql, params).then(() => 'allowed', (e: PgError) => e.code);
    check('app role cannot UPDATE inventory (42501)', (await denied('UPDATE inventory SET qty_available = 0')) === '42501');
    check('app role cannot INSERT ledger movements directly (42501)', (await denied(`INSERT INTO inventory_movements (inventory_id, movement_type, quantity, performed_by) VALUES ($1, 'RECEIPT', 1, $2)`, [invS, im1])) === '42501');
    check('app role cannot DELETE audit logs (42501)', (await denied('DELETE FROM audit_logs')) === '42501');
    check('app role cannot change transfer status directly (42501)', (await denied(`UPDATE transfer_requests SET status = 'RECEIVED'`)) === '42501');
    const { rows: clock } = await ap.query(`SELECT set_config('medshare.event_time', '2020-01-01', false), fn_now() > now() - interval '1 day' AS real_clock`);
    check('app role cannot back-date events (fn_now ignores medshare.event_time)', clock[0].real_clock === true);
    const { rows: recon } = await owner.query('SELECT count(*)::int AS n FROM fn_reconcile_inventory()');
    check('reconciliation after all races: 0 discrepancies', recon[0].n === 0);
  } finally {
    for (const c of opened.reverse()) await c.end().catch(() => undefined);
    const admin = await client(adminUrl);
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.end();
  }
}
