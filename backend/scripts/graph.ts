/**
 * Graph runner: sync | queries
 *
 * - sync:    rebuilds the Neo4j read model from PostgreSQL (as the least-privilege
 *            medshare_app role, the same connection the API uses).
 * - queries: runs every documented Cypher query in db/graph/queries.cypher
 *            and prints its result, like `npm run db:queries` does for SQL.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { closeGraph, cypher } from '../src/graph/neo4j.js';
import { syncGraph } from '../src/graph/sync.js';

const here = dirname(fileURLToPath(import.meta.url));
const QUERIES = join(here, '../db/graph/queries.cypher');

/** Splits the catalogue on its `// G01: title` headers. */
function catalogue() {
  const text = readFileSync(QUERIES, 'utf8');
  return text
    .split(/^(?=\/\/ G\d{2}:)/m)
    .filter((b) => b.startsWith('// G'))
    .map((b) => {
      const lines = b.trim().split('\n');
      const statement = lines.filter((l) => !l.trim().startsWith('//')).join('\n').trim().replace(/;$/, '');
      return { title: lines[0].slice(3), statement };
    });
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map(show).join(' → ');
  if (typeof v === 'object' && 'toString' in (v as object) && (v as object).constructor?.name !== 'Object') return String(v);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'sync') {
    const r = await syncGraph();
    console.log(`Graph synced from ${r.source} at ${r.syncedAt}`);
    console.log('  nodes:        ', Object.entries(r.nodes).map(([k, n]) => `${k} ${n}`).join(', '));
    console.log('  relationships:', Object.entries(r.relationships).map(([k, n]) => `${k} ${n}`).join(', '));
  } else if (cmd === 'queries') {
    let failed = 0;
    for (const q of catalogue()) {
      try {
        const rows = await cypher(q.statement);
        console.log(`\n✓ ${q.title}  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
        for (const row of rows.slice(0, 5)) console.log('   ', Object.entries(row).map(([k, v]) => `${k}=${show(v)}`).join('  '));
        if (rows.length > 5) console.log(`    … ${rows.length - 5} more`);
      } catch (e) {
        failed++;
        console.error(`\n✗ ${q.title}\n  ${(e as Error).message}`);
      }
    }
    if (failed) process.exitCode = 1;
  } else {
    console.error('Usage: tsx scripts/graph.ts <sync|queries>');
    process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([closeGraph(), pool.end()]));
