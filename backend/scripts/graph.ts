/**
 * Graph runner: sync | queries
 *
 * - sync:    rebuilds the Neo4j read model from PostgreSQL (as the least-privilege
 *            medshare_app role, the same connection the API uses).
 * - queries: runs every documented Cypher query in db/graph/queries.cypher
 *            and prints its result, like `npm run db:queries` does for SQL.
 */
import { pool } from '../src/db/pool.js';
import { graphCatalogue } from '../src/graph/catalogue.js';
import { runExplorerQuery } from '../src/graph/explorer.js';
import { closeGraph } from '../src/graph/neo4j.js';
import { syncGraph } from '../src/graph/sync.js';

const show = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map(show).join(' → ');
  if (typeof v === 'object' && 'path' in (v as object)) return (v as { path: string[] }).path.join(' → ');
  if (typeof v === 'object' && 'node' in (v as object)) return `(${(v as { labels: string[] }).labels.join(':')})`;
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
    // Through the explorer's read-only runner, so every documented query is proven to work there too.
    let failed = 0;
    for (const q of graphCatalogue()) {
      try {
        const { columns, rows } = await runExplorerQuery(q.statement);
        console.log(`\n✓ ${q.id}: ${q.title}  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
        for (const row of rows.slice(0, 5)) console.log('   ', columns.map((k, i) => `${k}=${show(row[i])}`).join('  '));
        if (rows.length > 5) console.log(`    … ${rows.length - 5} more`);
      } catch (e) {
        failed++;
        console.error(`\n✗ ${q.id}: ${q.title}\n  ${(e as Error).message}`);
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
