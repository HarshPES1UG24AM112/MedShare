/**
 * Runs every query in db/queries/dbms_queries.sql, read-only, as the application role,
 * and prints its row count and timing. Used to keep DBMS_DOCUMENTATION.md §13 honest:
 * each documented query is executed against the seeded database.
 *
 *   npm run db:queries            summary
 *   npm run db:queries -- --show  also print the first rows of each result
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, DB_DIR } from './lib/database.js';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });
const show = process.argv.includes('--show');

const text = readFileSync(join(DB_DIR, 'queries', 'dbms_queries.sql'), 'utf8');
const blocks = text.split(/^(?=-- Q\d{2}:)/m).filter((b) => b.startsWith('-- Q'));

const c = await connect(process.env.DATABASE_URL!, true);
let failed = 0;
try {
  // Read-only and least-privilege: a query that tried to write would fail here.
  await c.query('BEGIN READ ONLY');
  for (const block of blocks) {
    const title = block.split('\n')[0].replace(/^-- /, '');
    const t0 = performance.now();
    try {
      const { rows } = await c.query(block);
      console.log(`✓ ${title.padEnd(100)} ${String(rows.length).padStart(4)} rows  ${(performance.now() - t0).toFixed(0)} ms`);
      if (show) console.table(rows.slice(0, 5));
    } catch (e) {
      failed++;
      console.log(`✗ ${title}\n    ${(e as Error).message}`);
      await c.query('ROLLBACK');
      await c.query('BEGIN READ ONLY');
    }
  }
  await c.query('ROLLBACK');
} finally {
  await c.end();
}
console.log(failed ? `\n${failed} of ${blocks.length} queries failed.` : `\nAll ${blocks.length} queries ran.`);
process.exit(failed ? 1 : 0);
