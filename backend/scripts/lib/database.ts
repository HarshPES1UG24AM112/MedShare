/**
 * Reusable database lifecycle: migrate, seed, reset, create/drop databases.
 * Used by the CLI runner (scripts/db.ts) and the API test global setup.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const DB_DIR = resolve(here, '../../db');

// Line endings are normalised so a CRLF checkout doesn't look like an edited migration.
const sha = (s: string) => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
export const sqlFiles = (dir: string) =>
  readdirSync(join(DB_DIR, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

export const withDatabase = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

export async function connect(url: string, quiet = false) {
  const client = new pg.Client({ connectionString: url });
  if (!quiet) client.on('notice', (n) => console.log(`  ${n.message}`));
  await client.connect();
  return client;
}

export async function migrate(client: pg.Client, opts: { appPassword?: string; quiet?: boolean } = {}) {
  const log = (s: string) => !opts.quiet && process.stdout.write(s);
  const [bootstrap, ...rest] = sqlFiles('migrations');
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
    log(`→ ${file} … `);
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE medshare_owner');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, sum]);
      await client.query('COMMIT');
      log('ok\n');
    } catch (e) {
      await client.query('ROLLBACK');
      log('FAILED\n');
      throw e;
    }
  }

  if (opts.appPassword) {
    // Role passwords can't be bound as parameters; quote via format().
    const { rows } = await client.query(`SELECT format('ALTER ROLE medshare_app LOGIN PASSWORD %L', $1::text) AS stmt`, [opts.appPassword]);
    await client.query(rows[0].stmt);
  }
  log('Migrations up to date.\n');
}

async function runFile(client: pg.Client, dir: string, file: string, quiet = false) {
  const sql = readFileSync(join(DB_DIR, dir, file), 'utf8');
  if (!quiet) console.log(`→ ${dir}/${file}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

// Seed runs as the superuser session so fn_now() honours medshare.event_time
// (back-dated synthetic history); objects stay owned by medshare_owner.
export async function seed(client: pg.Client, quiet = false) {
  for (const f of sqlFiles('seed')) await runFile(client, 'seed', f, quiet);
}

export async function dropSchema(client: pg.Client) {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
}

/** Creates (or recreates) a database and returns its admin URL. */
export async function recreateDatabase(adminUrl: string, name: string) {
  const admin = await connect(adminUrl, true);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(adminUrl, name);
}

export async function dropDatabase(adminUrl: string, name: string) {
  const admin = await connect(adminUrl, true);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
