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

  it('rebuilds on demand through the admin job, for system administrators only', async () => {
    expect((await (await as(users.im('FAC-002'))).post('/admin/jobs/graph-sync')).status).toBe(403);
    const res = await (await as(users.admin)).post('/admin/jobs/graph-sync');
    expect(res.status).toBe(200);
    expect(res.body.nodes.Facility).toBe(15);
  });
});
