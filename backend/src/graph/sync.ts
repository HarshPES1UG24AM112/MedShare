/**
 * PostgreSQL → Neo4j sync. PostgreSQL is the system of record; the graph is a
 * read model rebuilt from one REPEATABLE READ snapshot, so every node and
 * relationship describes the same moment. A rebuild (not an incremental diff)
 * keeps it simple and provably consistent: the graph never holds a fact that
 * PostgreSQL does not.
 *
 * Distances and "may this facility supply that one" come from the same SQL
 * functions the transfer workflow uses (fn_distance_km, fn_is_transfer_authorised),
 * so the graph cannot disagree with what a transfer request would accept.
 */
import type pg from 'pg';
import { pool, query, withTransaction } from '../db/pool.js';
import { graphDriver, int } from './neo4j.js';

export interface SyncResult {
  syncedAt: string;
  source: string;
  nodes: Record<string, number>;
  relationships: Record<string, number>;
}

const SNAPSHOT = {
  organisations: `SELECT id, name, org_type AS type FROM organizations`,
  regions: `SELECT id, parent_id, name, level FROM v_region_tree`,
  facilities: `
    SELECT id, code, name, facility_type AS type, organization_id, region_id, latitude AS lat, longitude AS lon,
           has_cold_chain, max_dispatch_radius_km AS radius_km, is_active
    FROM facilities`,
  medicines: `SELECT id, code, name, requires_cold_chain, is_essential FROM medicines`,
  // Every unordered pair once (a < b): the distance is symmetric.
  roads: `SELECT a.id AS a, b.id AS b, fn_distance_km(a.id, b.id) AS km FROM facilities a JOIN facilities b ON a.id < b.id`,
  // Ordered pairs a transfer request would accept: inside the SOURCE's dispatch
  // radius, same organisation or an agreement in force today, both active.
  supply: `
    SELECT s.id AS source, d.id AS destination, fn_distance_km(s.id, d.id) AS km, s.organization_id = d.organization_id AS same_org
    FROM facilities s JOIN facilities d ON s.id <> d.id
    WHERE s.is_active AND d.is_active
      AND fn_distance_km(s.id, d.id) <= s.max_dispatch_radius_km
      AND fn_is_transfer_authorised(s.id, d.id)`,
  agreements: `
    SELECT organization_a_id AS a, organization_b_id AS b, valid_from::text, valid_to::text,
           daterange(valid_from, valid_to, '[)') @> fn_today() AS in_force
    FROM organization_agreements`,
  stock: `
    SELECT facility_id, medicine_id, usable, reserved, nearest_usable_expiry::text AS nearest_expiry
    FROM v_facility_stock WHERE usable > 0`,
  shortages: `
    SELECT facility_id, medicine_id, stock_status AS status, usable, round(days_of_inventory, 1) AS days_of_cover,
           round(daily_rate, 2) AS daily_rate, demand_basis
    FROM v_shortage_status WHERE stock_status IN ('CRITICAL', 'LOW')`,
  // Completed deliveries, aggregated into one supply corridor per direction.
  sent: `
    SELECT t.source_facility_id AS source, t.destination_facility_id AS destination, count(DISTINCT t.id) AS transfers,
           coalesce(sum(i.quantity_received), 0) AS units, to_json(max(t.updated_at)) #>> '{}' AS last_received_at
    FROM transfer_requests t JOIN transfer_items i ON i.transfer_id = t.id
    WHERE t.status = 'RECEIVED'
    GROUP BY 1, 2`,
} as const;

type Snapshot = { [K in keyof typeof SNAPSHOT]: Record<string, unknown>[] } & { database: string };

// The driver sends every JS number as a Cypher FLOAT; ids and counts must stay INTEGER
// so that `MATCH (f:Facility {id: 3})` typed by hand in Neo4j Browser finds them.
const INTEGER_KEYS = new Set(['id', 'parentId', 'organizationId', 'regionId', 'level', 'a', 'b', 'source', 'destination',
  'facilityId', 'medicineId', 'usable', 'reserved', 'transfers', 'units']);
const typed = (rows: Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, INTEGER_KEYS.has(k) && typeof v === 'number' ? int(v) : v])));

async function readSnapshot(db: pg.Pool): Promise<Snapshot> {
  return withTransaction(
    async (c) => {
      const out = { database: (await c.query('SELECT current_database() AS db')).rows[0].db } as Snapshot;
      for (const [key, sql] of Object.entries(SNAPSHOT)) {
        (out as Record<string, unknown>)[key] = await query(sql, [], c);
      }
      return out;
    },
    { isolation: 'REPEATABLE READ', readOnly: true },
    db,
  );
}

// Uniqueness constraints double as lookup indexes for MATCH by id.
const CONSTRAINTS = ['Organisation', 'Region', 'Facility', 'Medicine'].map(
  (label) => `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
);

// [what it creates, snapshot rows, statement], in dependency order (nodes before the relationships between them).
const WRITES: [string, keyof typeof SNAPSHOT, string][] = [
  ['Organisation', 'organisations', `UNWIND $rows AS r CREATE (:Organisation {id: r.id, name: r.name, type: r.type})`],
  ['Region', 'regions', `UNWIND $rows AS r CREATE (:Region {id: r.id, name: r.name, level: r.level})`],
  ['PART_OF', 'regions', `UNWIND [r IN $rows WHERE r.parentId IS NOT NULL] AS r
     MATCH (c:Region {id: r.id}), (p:Region {id: r.parentId}) CREATE (c)-[:PART_OF]->(p)`],
  ['Facility', 'facilities', `UNWIND $rows AS r
     MATCH (o:Organisation {id: r.organizationId}), (g:Region {id: r.regionId})
     CREATE (f:Facility {id: r.id, code: r.code, name: r.name, type: r.type, lat: r.lat, lon: r.lon,
                         location: point({latitude: r.lat, longitude: r.lon}),
                         coldChain: r.hasColdChain, radiusKm: r.radiusKm, active: r.isActive})
     CREATE (f)-[:BELONGS_TO]->(o), (f)-[:LOCATED_IN]->(g)`],
  ['Medicine', 'medicines', `UNWIND $rows AS r
     CREATE (:Medicine {id: r.id, code: r.code, name: r.name, coldChain: r.requiresColdChain, essential: r.isEssential})`],
  ['ROAD', 'roads', `UNWIND $rows AS r MATCH (a:Facility {id: r.a}), (b:Facility {id: r.b}) CREATE (a)-[:ROAD {km: r.km}]->(b)`],
  ['CAN_SUPPLY', 'supply', `UNWIND $rows AS r MATCH (s:Facility {id: r.source}), (d:Facility {id: r.destination})
     CREATE (s)-[:CAN_SUPPLY {km: r.km, sameOrg: r.sameOrg}]->(d)`],
  ['AGREEMENT', 'agreements', `UNWIND $rows AS r MATCH (a:Organisation {id: r.a}), (b:Organisation {id: r.b})
     CREATE (a)-[:AGREEMENT {validFrom: date(r.validFrom), validTo: CASE WHEN r.validTo IS NULL THEN null ELSE date(r.validTo) END,
                             inForce: r.inForce}]->(b)`],
  ['STOCKS', 'stock', `UNWIND $rows AS r MATCH (f:Facility {id: r.facilityId}), (m:Medicine {id: r.medicineId})
     CREATE (f)-[:STOCKS {usable: r.usable, reserved: r.reserved,
                          nearestExpiry: CASE WHEN r.nearestExpiry IS NULL THEN null ELSE date(r.nearestExpiry) END}]->(m)`],
  ['SHORT_OF', 'shortages', `UNWIND $rows AS r MATCH (f:Facility {id: r.facilityId}), (m:Medicine {id: r.medicineId})
     CREATE (f)-[:SHORT_OF {status: r.status, usable: r.usable, daysOfCover: r.daysOfCover, dailyRate: r.dailyRate,
                            demandBasis: r.demandBasis}]->(m)`],
  ['SENT', 'sent', `UNWIND $rows AS r MATCH (s:Facility {id: r.source}), (d:Facility {id: r.destination})
     CREATE (s)-[:SENT {transfers: r.transfers, units: r.units, lastReceivedAt: datetime(r.lastReceivedAt)}]->(d)`],
];

/** What the graph actually holds, counted in Neo4j rather than assumed from the input rows. */
export async function graphCounts() {
  const driver = graphDriver();
  const nodes = await driver.executeQuery('MATCH (n) WHERE NOT n:SyncInfo RETURN labels(n)[0] AS k, count(*) AS n ORDER BY k');
  const rels = await driver.executeQuery('MATCH ()-[r]->() RETURN type(r) AS k, count(*) AS n ORDER BY k');
  const toMap = (res: typeof nodes) => Object.fromEntries(res.records.map((r) => [r.get('k') as string, r.get('n') as number]));
  return { nodes: toMap(nodes), relationships: toMap(rels) };
}

/**
 * Rebuilds the whole graph from a PostgreSQL snapshot in one Neo4j write transaction.
 * `db` defaults to the API's own pool; the test runner passes its own database.
 */
export async function syncGraph(db: pg.Pool = pool): Promise<SyncResult> {
  const snap = await readSnapshot(db);
  const driver = graphDriver();
  for (const c of CONSTRAINTS) await driver.executeQuery(c);

  const syncedAt = new Date().toISOString();
  const session = driver.session();
  try {
    // One transaction: readers see the old graph or the new one, never a half-built one.
    await session.executeWrite(async (tx) => {
      await tx.run('MATCH (n) DETACH DELETE n');
      for (const [, key, statement] of WRITES) await tx.run(statement, { rows: typed(snap[key]) });
      await tx.run('CREATE (:SyncInfo {syncedAt: datetime($syncedAt), source: $source})', { syncedAt, source: snap.database });
    });
  } finally {
    await session.close();
  }
  return { syncedAt, source: snap.database, ...(await graphCounts()) };
}
