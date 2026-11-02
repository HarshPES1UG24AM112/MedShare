/**
 * Database runner: migrate | seed | reset | test
 *
 * - Connects with DATABASE_ADMIN_URL (superuser) — never used by the API.
 * - 000_bootstrap.sql runs as superuser (roles, schema ownership).
 * - Every later migration runs under `SET ROLE medshare_owner`, so objects and
 *   SECURITY DEFINER routines are owned by a non-superuser.
 * - Applied migrations are recorded (with checksum) in public.schema_migrations;
 *   editing an applied file is detected and refused.
 */
import { config as loadEnv } from 'dotenv';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runConcurrencyTests } from './concurrency.js';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

const DB_DIR = resolve(here, '../db');
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is not set (see .env.example)');

// Line endings are normalised so a CRLF checkout doesn't look like an edited migration.
const sha = (s: string) => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
const sqlFiles = (dir: string) =>
  readdirSync(join(DB_DIR, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

async function connect() {
  const client = new pg.Client({ connectionString: adminUrl });
  client.on('notice', (n) => console.log(`  ${n.message}`));
  await client.connect();
  return client;
}

async function migrate(client: pg.Client) {
  const files = sqlFiles('migrations');
  const [bootstrap, ...rest] = files;
  if (!bootstrap?.startsWith('000_')) throw new Error('migrations must start with 000_bootstrap.sql');

  // Bootstrap is idempotent and always re-run as superuser.
  await client.query(readFileSync(join(DB_DIR, 'migrations', bootstrap), 'utf8'));
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.schema_migrations OWNER TO medshare_owner;`);

  const applied = new Map<string, string>(
    (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum]),
  );

  for (const file of rest) {
    const sql = readFileSync(join(DB_DIR, 'migrations', file), 'utf8');
    const sum = sha(sql);
    if (applied.has(file)) {
      if (applied.get(file) !== sum) throw new Error(`${file} was modified after being applied — create a new migration instead`);
      continue;
    }
    process.stdout.write(`→ ${file} … `);
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE medshare_owner');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, sum]);
      await client.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw e;
    }
  }

  const appPassword = process.env.MEDSHARE_APP_PASSWORD;
  if (appPassword) {
    // Role passwords can't be bound as parameters; quote via format().
    const { rows } = await client.query(`SELECT format('ALTER ROLE medshare_app LOGIN PASSWORD %L', $1::text) AS stmt`, [appPassword]);
    await client.query(rows[0].stmt);
  }
  console.log('Migrations up to date.');
}

async function runFile(client: pg.Client, dir: string, file: string, asOwner: boolean) {
  const sql = readFileSync(join(DB_DIR, dir, file), 'utf8');
  console.log(`→ ${dir}/${file}`);
  await client.query('BEGIN');
  try {
    if (asOwner) await client.query('SET LOCAL ROLE medshare_owner');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function seed(client: pg.Client) {
  // Seed runs as the superuser session so fn_now() honours medshare.event_time
  // (back-dated synthetic history); objects stay owned by medshare_owner.
  for (const f of sqlFiles('seed')) await runFile(client, 'seed', f, false);
}

async function reset(client: pg.Client) {
  await client.query(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;`);
  console.log('Schema dropped.');
}

async function test(client: pg.Client) {
  // SQL tests run inside a transaction that the test file itself rolls back,
  // so they never change the seeded database.
  let failed = false;
  for (const f of sqlFiles('tests')) {
    const sql = readFileSync(join(DB_DIR, 'tests', f), 'utf8');
    console.log(`\n▶ tests/${f}`);
    try {
      await client.query(sql);
    } catch (e) {
      failed = true;
      console.error(`  ✗ ${(e as Error).message}`);
      await client.query('ROLLBACK').catch(() => undefined);
    }
  }
  console.log('\n▶ concurrency (multiple connections)');
  try {
    await runConcurrencyTests(adminUrl!);
  } catch (e) {
    failed = true;
    console.error(`  ✗ ${(e as Error).message}`);
  }
  if (failed) {
    console.error('\nDatabase tests FAILED');
    process.exitCode = 1;
  } else {
    console.log('\nAll database tests passed.');
  }
}

const cmd = process.argv[2];
const client = await connect();
try {
  if (cmd === 'migrate') await migrate(client);
  else if (cmd === 'seed') await seed(client);
  else if (cmd === 'reset') {
    await reset(client);
    await migrate(client);
    await seed(client);
  } else if (cmd === 'test') await test(client);
  else {
    console.error('usage: db.ts migrate | seed | reset | test');
    process.exitCode = 2;
  }
} catch (e) {
  const err = e as pg.DatabaseError;
  console.error(`\n${err.message}${err.where ? `\n  where: ${err.where}` : ''}${err.hint ? `\n  hint: ${err.hint}` : ''}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
