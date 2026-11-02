/**
 * Performance study on a scaled-up, disposable database (medshare_perf).
 *
 *   tsx scripts/perf.ts build     recreate medshare_perf: migrations + seed + db/perf/scale.sql
 *   tsx scripts/perf.ts explain   EXPLAIN (ANALYZE, BUFFERS) the API's queries, before and with
 *                                 each candidate index (created inside a transaction, then rolled
 *                                 back), and write docs/perf/EXPLAIN_RESULTS.md
 *
 * The queries are the SQL the API sends (copied from the route modules, with literal parameters),
 * executed as medshare_app so privileges and SECURITY DEFINER functions behave as in production.
 * The real medshare database is never touched.
 */
import { config as loadEnv } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { connect, DB_DIR, migrate, recreateDatabase, seed, withDatabase } from './lib/database.js';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });
const ADMIN = process.env.DATABASE_ADMIN_URL!;
const DB = 'medshare_perf';
const OUT = resolve(here, '../docs/perf');
const BASELINE = '008';
/** Migration 009, applied (and rolled back) as a candidate against the 008 baseline. */
const M009 = { name: 'migration 009_query_performance', ddl: readFileSync(join(DB_DIR, 'migrations', '009_query_performance.sql'), 'utf8') };

interface Case {
  id: string;
  title: string;
  why: string;
  sql: string;
  /** Candidate indexes to evaluate against this query (created in a transaction, then rolled back). */
  candidates: { name: string; ddl: string; sql?: string }[];
}

const medicineSelect = `
  SELECT c.id, c.code, c.name, c.strength_label, c.display_name, c.dosage_form, c.unit_volume_ml, c.unit,
         c.category_id, c.category, c.category_path, c.requires_cold_chain, c.is_essential, c.is_active, c.description,
         c.substances, a.network_usable, a.facilities_holding, a.facilities_short, a.nearest_expiry, c.created_at, c.updated_at
  FROM v_medicine_catalogue c
  JOIN v_medicine_availability a ON a.medicine_id = c.id`;

const searchPredicate = (s: string) => `
  (c.name ILIKE '%${s}%' OR c.code ILIKE '%${s}%'
   OR EXISTS (SELECT 1 FROM medicine_ingredients i JOIN substances s ON s.id = i.substance_id WHERE i.medicine_id = c.id AND s.name ILIKE '%${s}%')
   OR EXISTS (SELECT 1 FROM medicine_batches b JOIN manufacturers mf ON mf.id = b.manufacturer_id WHERE b.medicine_id = c.id AND mf.name ILIKE '%${s}%'))`;

const page = (base: string, order: string) =>
  `SELECT t.*, count(*) OVER () AS total_count FROM (${base}) t ORDER BY ${order}, 1 LIMIT 20 OFFSET 0`;

const transferSelect = `
  SELECT t.id, t.code, t.status, t.created_at, t.updated_at,
         json_build_object('id', s.id, 'code', s.code, 'name', s.name) AS source_facility,
         json_build_object('id', d.id, 'code', d.code, 'name', d.name) AS destination_facility,
         (s.organization_id <> d.organization_id) AS cross_organization,
         json_build_object('id', u.id, 'name', u.full_name) AS requested_by,
         t.request_notes, t.rejection_reason, t.recommendation_id,
         (SELECT count(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS item_count,
         (SELECT coalesce(sum(ti.quantity), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS total_units,
         (SELECT string_agg(DISTINCT m.name, ', ') FROM transfer_items ti
            JOIN medicine_batches b ON b.id = ti.batch_id JOIN medicines m ON m.id = b.medicine_id WHERE ti.transfer_id = t.id) AS medicines
  FROM transfer_requests t
  JOIN facilities s ON s.id = t.source_facility_id
  JOIN facilities d ON d.id = t.destination_facility_id
  JOIN users u ON u.id = t.requested_by`;

const pendingFor = (scope: string) => `
  SELECT x.* FROM (${transferSelect}) x
  WHERE (${scope}::int[] IS NULL OR (x.source_facility->>'id')::int = ANY(${scope}::int[])
                              OR (x.destination_facility->>'id')::int = ANY(${scope}::int[]))
    AND x.status = 'PENDING'`;

const CASES: Case[] = [
  {
    id: 'Q1a',
    title: 'Medicine search predicate (trigram)',
    why: 'GET /medicines?search=cillin: name, code, substance or manufacturer ILIKE. Isolates the search itself.',
    sql: `SELECT c.id, c.name FROM medicines c WHERE ${searchPredicate('cillin')} AND c.is_active`,
    candidates: [
      { name: 'ix_medicines_code_trgm', ddl: 'CREATE INDEX ix_medicines_code_trgm ON medicines USING gin (code gin_trgm_ops)' },
    ],
  },
  {
    id: 'Q1b',
    title: 'Medicine search, full endpoint query',
    why: 'The same request as the API sends it: catalogue view + network availability + pagination window.',
    sql: page(`${medicineSelect} WHERE ${searchPredicate('cillin')} AND c.is_active`, 'name ASC NULLS LAST'),
    candidates: [M009],
  },
  {
    id: 'Q2',
    title: 'FEFO sourcing options',
    why: 'GET /medicines/1/sources?destinationFacilityId=3: eligible partner batches, earliest expiry first.',
    sql: `SELECT i.id AS inventory_id, b.id AS batch_id, b.batch_number, b.expiry_date, (b.expiry_date - fn_today()) AS days_to_expiry,
                i.qty_available, json_build_object('id', f.id, 'code', f.code, 'name', f.name) AS facility,
                fn_distance_km(f.id, d.id) AS distance_km, (f.organization_id <> d.organization_id) AS cross_organization,
                ss.stock_status AS source_stock_status
         FROM inventory i
         JOIN medicine_batches b ON b.id = i.batch_id
         JOIN medicines m ON m.id = b.medicine_id
         JOIN facilities f ON f.id = i.facility_id
         JOIN facilities d ON d.id = 3
         CROSS JOIN engine_config e
         LEFT JOIN v_shortage_status ss ON ss.facility_id = f.id AND ss.medicine_id = m.id
         WHERE b.medicine_id = 1 AND f.id <> d.id AND f.is_active AND i.qty_available > 0
           AND b.status = 'ACTIVE' AND b.expiry_date >= fn_today() + e.min_remaining_shelf_life_days
           AND fn_is_transfer_authorised(f.id, d.id)
           AND fn_distance_km(f.id, d.id) <= f.max_dispatch_radius_km
           AND (NOT m.requires_cold_chain OR (f.has_cold_chain AND d.has_cold_chain))
         ORDER BY b.expiry_date, distance_km
         LIMIT 50`,
    candidates: [
      {
        name: 'ix_movements_dispense_inventory',
        ddl: `CREATE INDEX ix_movements_dispense_inventory ON inventory_movements (inventory_id, created_at)
              INCLUDE (quantity) WHERE movement_type = 'DISPENSE'`,
      },
      M009,
      {
        name: 'migration 009 + per-facility partner CTE (route rewrite)',
        ddl: M009.ddl,
        sql: `WITH partners AS MATERIALIZED (
                SELECT f.id, f.code, f.name, f.has_cold_chain, d.has_cold_chain AS destination_cold_chain,
                       fn_distance_km(f.id, d.id) AS distance_km, (f.organization_id <> d.organization_id) AS cross_organization
                FROM facilities f JOIN facilities d ON d.id = 3
                WHERE f.id <> d.id AND f.is_active AND fn_is_transfer_authorised(f.id, d.id)
                  AND fn_distance_km(f.id, d.id) <= f.max_dispatch_radius_km)
              SELECT i.id AS inventory_id, b.id AS batch_id, b.batch_number, b.expiry_date, (b.expiry_date - fn_today()) AS days_to_expiry,
                     i.qty_available, json_build_object('id', p.id, 'code', p.code, 'name', p.name) AS facility,
                     p.distance_km, p.cross_organization, ss.stock_status AS source_stock_status
              FROM partners p
              JOIN inventory i ON i.facility_id = p.id
              JOIN medicine_batches b ON b.id = i.batch_id
              JOIN medicines m ON m.id = b.medicine_id
              CROSS JOIN engine_config e
              LEFT JOIN v_shortage_status ss ON ss.facility_id = p.id AND ss.medicine_id = m.id
              WHERE b.medicine_id = 1 AND i.qty_available > 0
                AND b.status = 'ACTIVE' AND b.expiry_date >= fn_today() + e.min_remaining_shelf_life_days
                AND (NOT m.requires_cold_chain OR (p.has_cold_chain AND p.destination_cold_chain))
              ORDER BY b.expiry_date, p.distance_km
              LIMIT 50`,
      },
    ],
  },
  {
    id: 'Q3a',
    title: 'Monthly consumption aggregation (mv_monthly_consumption refresh)',
    why: 'What REFRESH MATERIALIZED VIEW mv_monthly_consumption executes: DISPENSE movements grouped by month, facility and medicine.',
    sql: `SELECT date_trunc('month', mv.created_at)::date AS month, i.facility_id, b.medicine_id,
                 sum(mv.quantity) AS units_dispensed, count(*) AS dispense_events
          FROM inventory_movements mv
          JOIN inventory i        ON i.id = mv.inventory_id
          JOIN medicine_batches b ON b.id = i.batch_id
          WHERE mv.movement_type = 'DISPENSE'
          GROUP BY 1, 2, 3`,
    candidates: [],
  },
  {
    id: 'Q3b',
    title: 'Monthly consumption, analytics read',
    why: 'GET /analytics/overview?months=12: monthly totals for one organisation scope, read from the materialized view.',
    sql: `SELECT to_char(month, 'YYYY-MM') AS month, sum(units_dispensed) AS units, sum(dispense_events) AS events
          FROM mv_monthly_consumption
          WHERE month >= date_trunc('month', fn_today()) - make_interval(months => 11) AND facility_id = ANY('{1,2,3,4,5}'::int[])
          GROUP BY month ORDER BY month`,
    candidates: [{ name: 'ix_mv_monthly_facility_month', ddl: 'CREATE INDEX ix_mv_monthly_facility_month ON mv_monthly_consumption (facility_id, month)' }],
  },
  {
    id: 'Q4a',
    title: 'Pending transfers, network scope',
    why: 'GET /transfers?status=PENDING as a platform user (no facility filter), newest first.',
    sql: page(pendingFor('NULL'), 'created_at DESC NULLS LAST'),
    candidates: [
      { name: 'ix_transfer_items_transfer', ddl: 'CREATE INDEX ix_transfer_items_transfer ON transfer_items (transfer_id) INCLUDE (quantity, batch_id)' },
    ],
  },
  {
    id: 'Q4b',
    title: 'Pending transfers, one facility',
    why: 'GET /transfers?status=PENDING&facilityId=3 (incoming or outgoing).',
    sql: page(pendingFor(`'{3}'`), 'created_at DESC NULLS LAST'),
    candidates: [
      { name: 'ix_transfer_items_transfer', ddl: 'CREATE INDEX ix_transfer_items_transfer ON transfer_items (transfer_id) INCLUDE (quantity, batch_id)' },
    ],
  },
];

async function build() {
  const url = await recreateDatabase(ADMIN, DB);
  const c = await connect(url, true);
  try {
    console.log('migrating + seeding medshare_perf …');
    // Baseline = migrations up to 008; 009 (the query-performance migration) is evaluated as a candidate.
    await migrate(c, { appPassword: process.env.MEDSHARE_APP_PASSWORD, quiet: true, until: BASELINE });
    await seed(c, true);
    console.log('scaling (this takes a few minutes) …');
    const t0 = Date.now();
    await c.query(readFileSync(join(DB_DIR, 'perf', 'scale.sql'), 'utf8'));
    await c.query('REFRESH MATERIALIZED VIEW mv_monthly_consumption');
    await c.query('VACUUM ANALYZE');
    console.log(`scaled in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const { rows } = await c.query(`SELECT relname, n_live_tup FROM pg_stat_user_tables
      WHERE relname IN ('facilities','medicines','medicine_batches','inventory','inventory_movements','transfer_requests','transfer_items','facility_medicine_settings')
      ORDER BY n_live_tup DESC`);
    for (const r of rows) console.log(`  ${r.relname.padEnd(28)} ${Number(r.n_live_tup).toLocaleString('en-IN')}`);
  } finally {
    await c.end();
  }
}

async function explain(c: pg.Client, sql: string) {
  // Warm once so both measurements see a warm cache, then measure.
  await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
  const { rows } = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
  const text = rows.map((r) => r['QUERY PLAN']).join('\n');
  const ms = Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1] ?? NaN);
  return { text, ms };
}

async function runExplain() {
  const c = await connect(withDatabase(ADMIN, DB), true);
  mkdirSync(OUT, { recursive: true });
  const { rows: sizes } = await c.query(`SELECT relname, n_live_tup FROM pg_stat_user_tables
    WHERE relname IN ('facilities','medicines','medicine_batches','inventory','inventory_movements','transfer_requests','transfer_items','facility_medicine_settings')
    ORDER BY n_live_tup DESC`);
  const { rows: ver } = await c.query('SHOW server_version');
  let md = `# EXPLAIN (ANALYZE, BUFFERS): before / after\n\nGenerated by \`npm run perf:explain\` on PostgreSQL ${ver[0].server_version}, database \`medshare_perf\` (synthetic, scaled; see \`db/perf/scale.sql\`). Each plan is measured on a warm cache (one run discarded). Queries execute as \`medshare_app\`. Candidate indexes are created inside a transaction, measured, then rolled back.\n\n| Table | Rows |\n|---|---|\n`;
  for (const s of sizes) md += `| ${s.relname} | ${Number(s.n_live_tup).toLocaleString('en-IN')} |\n`;
  const summary: string[] = [];

  for (const k of CASES) {
    await c.query('SET ROLE medshare_app');
    const before = await explain(c, k.sql);
    await c.query('RESET ROLE');
    md += `\n## ${k.id}: ${k.title}\n\n${k.why}\n\n**Before**: ${before.ms.toFixed(1)} ms\n\n\`\`\`\n${before.text}\n\`\`\`\n`;
    let line = `| ${k.id} | ${k.title} | ${before.ms.toFixed(1)} |`;
    if (!k.candidates.length) line += ' — | — |';
    for (const cand of k.candidates) {
      await c.query('BEGIN');
      try {
        await c.query(cand.ddl);
        await c.query('ANALYZE');
        await c.query('SET LOCAL ROLE medshare_app');
        const after = await explain(c, cand.sql ?? k.sql);
        // Multi-statement candidates (a whole migration) are referenced rather than inlined.
        const ddl = cand.ddl.includes('\n--') ? `-- see db/migrations/009_query_performance.sql` : cand.ddl.replace(/\s+/g, ' ');
        md += `\n**With \`${cand.name}\`**: ${after.ms.toFixed(1)} ms\n\n\`\`\`sql\n${ddl}\n\`\`\`\n\n\`\`\`\n${after.text}\n\`\`\`\n`;
        summary.push(`${line} ${cand.name} | ${after.ms.toFixed(1)} |`);
      } finally {
        await c.query('ROLLBACK');
      }
    }
    if (!k.candidates.length) summary.push(line);
    console.log(summary.filter((s) => s.startsWith(`| ${k.id} `)).join('\n'));
  }
  // 009 must change speed, not answers: fingerprint the rewritten views (and the view built on them) before and after.
  const fingerprint = async () =>
    (
      await c.query(`SELECT
        (SELECT md5(string_agg(t::text, '|' ORDER BY t.medicine_id)) FROM v_medicine_availability t) AS v_medicine_availability,
        (SELECT md5(string_agg(t::text, '|' ORDER BY t.inventory_id)) FROM v_inventory_detail t) AS v_inventory_detail,
        (SELECT md5(string_agg(t::text, '|' ORDER BY t.facility_id, t.medicine_id)) FROM v_shortage_status t) AS v_shortage_status`)
    ).rows[0] as Record<string, string>;
  const fpBefore = await fingerprint();
  await c.query('BEGIN');
  await c.query(M009.ddl);
  const fpAfter = await fingerprint();
  await c.query('ROLLBACK');
  md += `\n## Result equivalence of migration 009\n\nMD5 of every row of each view (ordered by key), before and after 009 on the scaled dataset:\n\n| View | Before | After | Same |\n|---|---|---|---|\n`;
  for (const v of Object.keys(fpBefore)) md += `| ${v} | \`${fpBefore[v]}\` | \`${fpAfter[v]}\` | ${fpBefore[v] === fpAfter[v] ? 'yes' : '**NO**'} |\n`;
  console.log(`009 result equivalence: ${Object.keys(fpBefore).every((v) => fpBefore[v] === fpAfter[v]) ? 'identical' : 'DIFFERENT'}`);

  md = md.replace('\n## Q1a', `\n## Summary\n\n| Query | What | Before (ms) | Candidate | With candidate (ms) |\n|---|---|---|---|---|\n${summary.join('\n')}\n\n## Q1a`);
  writeFileSync(join(OUT, 'EXPLAIN_RESULTS.md'), md);
  console.log(`wrote ${join(OUT, 'EXPLAIN_RESULTS.md')}`);
  await c.end();
}

const cmd = process.argv[2];
if (cmd === 'build') await build();
else if (cmd === 'explain') await runExplain();
else {
  console.error('usage: tsx scripts/perf.ts build|explain');
  process.exit(1);
}
