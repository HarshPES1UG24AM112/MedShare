import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool.js';
import { syncGraph } from '../src/graph/sync.js';
import { as, facility, medicineId, users } from './helpers.js';

// The graph is rebuilt from this test database first; global teardown rebuilds it
// from the development database again (Neo4j Community has a single database).
beforeAll(async () => {
  await syncGraph();
});

const pairs = (rows: { source: number; destination: number }[]) => rows.map((r) => `${r.source}>${r.destination}`).sort();

describe('facility network (Neo4j graph read model)', () => {
  it('reports what the graph holds and which database it was built from', async () => {
    const res = await (await as(users.admin)).get('/network/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, reachable: true, source: 'medshare_api_test' });
    expect(res.body.nodes.Facility).toBe(15);
    expect(res.body.relationships.ROAD).toBe((15 * 14) / 2);
  });

  it('holds exactly the supply links PostgreSQL would accept as transfer requests', async () => {
    const sql = await query<{ source: number; destination: number }>(`
      SELECT s.id AS source, d.id AS destination FROM facilities s JOIN facilities d ON s.id <> d.id
      WHERE s.is_active AND d.is_active AND fn_distance_km(s.id, d.id) <= s.max_dispatch_radius_km
        AND fn_is_transfer_authorised(s.id, d.id)`);
    const res = await (await as(users.admin)).get('/network/graph');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('medshare_api_test');
    expect(res.body.facilities).toHaveLength(15);
    expect(pairs(res.body.supplyLinks)).toEqual(pairs(sql));
  });

  it('gives the routed distance the database uses, beside the straight-line one', async () => {
    const [a, b] = [await facility('FAC-001'), await facility('FAC-007')];
    const res = await (await as(users.im('FAC-002'))).get(`/network/distance?from=${a}&to=${b}`);
    expect(res.status).toBe(200);
    const [{ km }] = await query<{ km: number }>('SELECT fn_distance_km($1, $2) AS km', [a, b]);
    expect(res.body.routedKm).toBe(km);
    // fn_distance_km is the great-circle distance x 1.3, rounded to 0.1 km.
    expect(Math.abs(res.body.straightLineKm * 1.3 - km)).toBeLessThan(0.3);
    expect(res.body.from.code).toBe('FAC-001');
  });

  it('finds a chain of legal supply links between facilities that cannot trade directly', async () => {
    const [a, b] = [await facility('FAC-009'), await facility('FAC-003')];
    const res = await (await as(users.admin)).get(`/network/distance?from=${a}&to=${b}`);
    expect(res.body.fromCanSupplyTo).toBe(false);
    expect(res.body.supplyChain.hops).toBeGreaterThan(1);
    expect(res.body.supplyChain.facilities[0].code).toBe('FAC-009');
    expect(res.body.supplyChain.facilities.at(-1).code).toBe('FAC-003');
  });

  it('rejects a distance request for the same facility twice', async () => {
    const a = await facility('FAC-001');
    const res = await (await as(users.admin)).get(`/network/distance?from=${a}&to=${a}`);
    expect(res.status).toBe(422);
  });

  it('lists legal suppliers nearest first, and with a medicine only those that hold it', async () => {
    const fid = await facility('FAC-002');
    const api = await as(users.im('FAC-002'));
    const all = (await api.get(`/network/facilities/${fid}/suppliers`)).body.suppliers as { id: number; km: number }[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.map((s) => s.km)).toEqual([...all.map((s) => s.km)].sort((x, y) => x - y));

    const med = await medicineId('MED-0001');
    const holders = (await api.get(`/network/facilities/${fid}/suppliers?medicineId=${med}`)).body.suppliers as { id: number; usable: number }[];
    const sql = await query<{ facilityId: number; usable: number }>(
      'SELECT facility_id, usable FROM v_facility_stock WHERE medicine_id = $1 AND usable > 0', [med]);
    const usable = new Map(sql.map((r) => [r.facilityId, r.usable]));
    expect(holders.length).toBeGreaterThan(0);
    for (const h of holders) {
      expect(all.some((s) => s.id === h.id)).toBe(true);
      expect(h.usable).toBe(usable.get(h.id));
    }
  });

  it('keeps facility scope: another facility\'s suppliers are refused, other facilities\' shortages hidden', async () => {
    const [own, other] = [await facility('FAC-002'), await facility('FAC-004')];
    const api = await as(users.im('FAC-002'));
    expect((await api.get(`/network/facilities/${other}/suppliers`)).status).toBe(403);
    const graph = (await api.get('/network/graph')).body.facilities as { id: number; criticalShortages: number | null }[];
    expect(graph.find((f) => f.id === own)!.criticalShortages).not.toBeNull();
    expect(graph.find((f) => f.id === other)!.criticalShortages).toBeNull();
  });

  it('query explorer: lists the documented queries and runs one into a table and a graph', async () => {
    const api = await as(users.admin);
    const list = (await api.get('/network/queries')).body as { id: string }[];
    expect(list.map((q) => q.id)).toEqual(Array.from({ length: list.length }, (_, i) => `G${String(i + 1).padStart(2, '0')}`));
    expect(list.length).toBeGreaterThanOrEqual(18);

    const chain = await api.post('/network/queries/run', { id: 'G16' });
    expect(chain.status).toBe(200);
    expect(chain.body.columns).toEqual(['p']);
    expect(chain.body.rows[0][0].path).toEqual(['FAC-009', 'FAC-012', 'FAC-003']);
    expect(chain.body.graph.nodes).toHaveLength(3);
    expect(chain.body.graph.relationships.map((r: { type: string }) => r.type)).toEqual(['CAN_SUPPLY', 'CAN_SUPPLY']);

    // Every relationship in the graph view joins two nodes that are also in it.
    const net = (await api.post('/network/queries/run', { id: 'G14' })).body;
    const ids = new Set(net.graph.nodes.map((n: { id: string }) => n.id));
    expect(net.graph.relationships).toHaveLength(net.rows.length);
    expect(net.graph.relationships.every((r: { start: string; end: string }) => ids.has(r.start) && ids.has(r.end))).toBe(true);
  });

  it('query explorer: runs a typed statement, keeps the columns of an empty result, and reports Cypher errors', async () => {
    const api = await as(users.auditor);
    const ok = await api.post('/network/queries/run', { statement: "MATCH (f:Facility {code: 'FAC-001'}) RETURN f.name AS name, f.radiusKm AS radius" });
    expect(ok.body.rows).toEqual([['Bengaluru Central District Hospital', 120]]);
    const empty = await api.post('/network/queries/run', { statement: "MATCH (f:Facility {code: 'NOPE'}) RETURN f.name AS name" });
    expect(empty.body).toMatchObject({ columns: ['name'], rows: [] });
    const bad = await api.post('/network/queries/run', { statement: 'MATCH (f:Facility RETURN f' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CYPHER_ERROR');
  });

  it('query explorer: is read-only and refuses procedures, LOAD CSV and non-platform users', async () => {
    const api = await as(users.admin);
    const write = await api.post('/network/queries/run', { statement: "MATCH (f:Facility {code: 'FAC-001'}) SET f.name = 'Hacked' RETURN f" });
    expect(write.status).toBe(422);
    expect(write.body.error.code).toBe('READ_ONLY');
    const [{ name }] = (await api.post('/network/queries/run', { statement: "MATCH (f:Facility {code: 'FAC-001'}) RETURN f.name AS name" })).body.rows.map(
      (r: string[]) => ({ name: r[0] }),
    );
    expect(name).toBe('Bengaluru Central District Hospital');
    for (const statement of ['CALL dbms.listConfig()', "LOAD CSV FROM 'http://example.com/x.csv' AS r RETURN r", 'SHOW USERS']) {
      const res = await api.post('/network/queries/run', { statement });
      expect(res.body.error.code).toBe('CYPHER_NOT_ALLOWED');
    }
    const subquery = await api.post('/network/queries/run', { statement: 'CALL { MATCH (f:Facility) RETURN count(f) AS n } RETURN n' });
    expect(subquery.body.rows).toEqual([[15]]);
    expect((await (await as(users.fm('FAC-001'))).get('/network/queries')).status).toBe(403);
    expect((await (await as(users.org1Admin)).post('/network/queries/run', { id: 'G01' })).status).toBe(403);
  });

  it('rebuilds on demand through the admin job, for system administrators only', async () => {
    expect((await (await as(users.im('FAC-002'))).post('/admin/jobs/graph-sync')).status).toBe(403);
    const res = await (await as(users.admin)).post('/admin/jobs/graph-sync');
    expect(res.status).toBe(200);
    expect(res.body.nodes.Facility).toBe(15);
  });
});
