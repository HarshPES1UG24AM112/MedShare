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
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { runConcurrencyTests } from './concurrency.js';
import { connect, DB_DIR, dropSchema, migrate, seed, sqlFiles } from './lib/database.js';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is not set (see .env.example)');
const appPassword = process.env.MEDSHARE_APP_PASSWORD;

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
const client = await connect(adminUrl);
try {
  if (cmd === 'migrate') await migrate(client, { appPassword });
  else if (cmd === 'seed') await seed(client);
  else if (cmd === 'reset') {
    await dropSchema(client);
    console.log('Schema dropped.');
    await migrate(client, { appPassword });
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
