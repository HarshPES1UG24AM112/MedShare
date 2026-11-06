/**
 * Facility network, answered from the Neo4j graph read model (see src/graph/sync.ts).
 * Writes never come here: PostgreSQL stays the system of record, and the graph is
 * rebuilt from it by `npm run graph:sync` or POST /admin/jobs/graph-sync.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, facilityScope } from '../auth/auth.js';
import { graphCatalogue } from '../graph/catalogue.js';
import { runExplorerQuery } from '../graph/explorer.js';
import { cypher, graphConfigured, int } from '../graph/neo4j.js';
import { graphCounts } from '../graph/sync.js';
import { ApiError, forbidden, notFound } from '../http/errors.js';
import { handler, id, idParam } from '../http/helpers.js';

export const router = Router();
router.use('/network', authenticate);

interface SyncInfo {
  syncedAt: string;
  source: string;
}

async function syncInfo(): Promise<SyncInfo> {
  const [row] = await cypher<SyncInfo>('MATCH (s:SyncInfo) RETURN toString(s.syncedAt) AS syncedAt, s.source AS source');
  if (!row) throw new ApiError(503, 'GRAPH_NOT_SYNCED', 'The graph has not been built yet. Run `npm run graph:sync` in backend/.');
  return row;
}

/** Facilities whose operational detail (shortages, deliveries) this user may see; null = all. */
function visible(req: Request): Set<number> | null {
  const user = currentUser(req);
  return user.platformScope ? null : new Set(user.scopeFacilityIds);
}

router.get(
  '/network/status',
  handler(async (_req, res) => {
    if (!graphConfigured()) return res.json({ configured: false, reachable: false });
    try {
      const info = await syncInfo().catch((e) => (e instanceof ApiError && e.code === 'GRAPH_NOT_SYNCED' ? null : Promise.reject(e)));
      res.json({ configured: true, reachable: true, syncedAt: info?.syncedAt ?? null, source: info?.source ?? null, ...(await graphCounts()) });
    } catch (e) {
      res.json({ configured: true, reachable: false, error: (e as Error).message });
    }
  }),
);

// Everything the network map draws, in one round trip per relationship type.
router.get(
  '/network/graph',
  handler(async (req, res) => {
    const info = await syncInfo();
    const scope = visible(req);
    const seen = (id: number) => !scope || scope.has(id);

    const [facilities, organisations, supplyLinks, roads, corridors] = await Promise.all([
      cypher<{ id: number; criticalShortages: number; lowShortages: number }>(`
        MATCH (f:Facility)-[:BELONGS_TO]->(o:Organisation), (f)-[:LOCATED_IN]->(r:Region)
        RETURN f.id AS id, f.code AS code, f.name AS name, f.type AS type, f.lat AS lat, f.lon AS lon,
               f.coldChain AS coldChain, f.radiusKm AS radiusKm, f.active AS active,
               o.id AS organizationId, r.name AS regionName,
               COUNT { ()-[:CAN_SUPPLY]->(f) } AS suppliers, COUNT { (f)-[:CAN_SUPPLY]->() } AS canSupply,
               COUNT { (f)-[:SHORT_OF {status: 'CRITICAL'}]->() } AS criticalShortages,
               COUNT { (f)-[:SHORT_OF {status: 'LOW'}]->() } AS lowShortages
        ORDER BY f.code`),
      cypher('MATCH (o:Organisation) RETURN o.id AS id, o.name AS name, o.type AS type ORDER BY o.name'),
      cypher(`MATCH (s:Facility)-[c:CAN_SUPPLY]->(d:Facility)
              RETURN s.id AS source, d.id AS destination, c.km AS km, c.sameOrg AS sameOrg ORDER BY s.id, d.id`),
      cypher('MATCH (a:Facility)-[r:ROAD]->(b:Facility) RETURN a.id AS a, b.id AS b, r.km AS km ORDER BY a.id, b.id'),
      cypher<{ source: number; destination: number }>(`
        MATCH (s:Facility)-[t:SENT]->(d:Facility)
        RETURN s.id AS source, d.id AS destination, t.transfers AS transfers, t.units AS units,
               toString(t.lastReceivedAt) AS lastReceivedAt ORDER BY t.units DESC`),
    ]);

    res.json({
      ...info,
      facilities: facilities.map((f) => (seen(f.id) ? f : { ...f, criticalShortages: null, lowShortages: null })),
      organisations,
      supplyLinks,
      roads,
      // A delivery is visible when either end is in the user's scope, as in transfer history.
      corridors: corridors.filter((c) => seen(c.source) || seen(c.destination)),
    });
  }),
);

// The distance between two facilities, whether either may supply the other, and the
// shortest chain of legal supply links between them when there is no direct one.
router.get(
  '/network/distance',
  handler(async (req, res) => {
    const q = z.object({ from: id, to: id }).refine((v) => v.from !== v.to, { path: ['to'], message: 'Choose two different facilities' }).parse(req.query);
    await syncInfo();
    const [row] = await cypher(
      `MATCH (a:Facility {id: $from}), (b:Facility {id: $to})
       OPTIONAL MATCH (a)-[r:ROAD]-(b)
       OPTIONAL MATCH p = shortestPath((a)-[:CAN_SUPPLY*..4]->(b))
       RETURN a { .id, .code, .name } AS from, b { .id, .code, .name } AS to,
              r.km AS routedKm, round(point.distance(a.location, b.location) / 1000, 1) AS straightLineKm,
              EXISTS { (a)-[:CAN_SUPPLY]->(b) } AS fromCanSupplyTo, EXISTS { (b)-[:CAN_SUPPLY]->(a) } AS toCanSupplyFrom,
              CASE WHEN p IS NULL THEN null ELSE {
                facilities: [n IN nodes(p) | n { .id, .code, .name }],
                hops: length(p),
                km: reduce(km = 0.0, x IN relationships(p) | km + x.km)
              } END AS supplyChain`,
      { from: int(q.from), to: int(q.to) },
    );
    if (!row) throw notFound('Facility');
    res.json(row);
  }),
);

// Facilities that may supply this one (inside their dispatch radius, same organisation
// or an agreement in force), nearest first; with medicineId, only those holding it.
router.get(
  '/network/facilities/:id/suppliers',
  handler(async (req, res) => {
    const facilityId = idParam(req);
    facilityScope(req, facilityId);
    const { medicineId } = z.object({ medicineId: id.optional() }).parse(req.query);
    const info = await syncInfo();
    const [target] = await cypher('MATCH (f:Facility {id: $id}) RETURN f.id AS id', { id: int(facilityId) });
    if (!target) throw notFound('Facility');

    const suppliers = await cypher(
      `MATCH (s:Facility)-[c:CAN_SUPPLY]->(:Facility {id: $id})
       MATCH (s)-[:BELONGS_TO]->(o:Organisation)
       ${medicineId ? 'MATCH (s)-[st:STOCKS]->(:Medicine {id: $medicineId})' : 'WITH s, c, o, null AS st'}
       RETURN s.id AS id, s.code AS code, s.name AS name, s.type AS type, s.coldChain AS coldChain,
              o.name AS organizationName, c.km AS km, c.sameOrg AS sameOrg,
              st.usable AS usable, toString(st.nearestExpiry) AS nearestExpiry
       ORDER BY km, code`,
      { id: int(facilityId), medicineId: medicineId ? int(medicineId) : null },
    );
    res.json({ syncedAt: info.syncedAt, facilityId, medicineId: medicineId ?? null, suppliers });
  }),
);

/* --------------------------------------------------------- query explorer ---- */

// Cypher reads the whole network, every facility's stock and shortages included, so
// the explorer is for platform-wide accounts only (system administrator, platform auditor).
function requirePlatformScope(req: Request) {
  if (!currentUser(req).platformScope) throw forbidden('The query explorer is available to platform-wide accounts only');
}

router.get(
  '/network/queries',
  handler(async (req, res) => {
    requirePlatformScope(req);
    res.json(graphCatalogue());
  }),
);

router.post(
  '/network/queries/run',
  handler(async (req, res) => {
    requirePlatformScope(req);
    const b = z
      .object({ id: z.string().regex(/^G\d{2}$/).optional(), statement: z.string().trim().min(1).max(4000).optional() })
      .refine((v) => Boolean(v.id) !== Boolean(v.statement), { path: ['statement'], message: 'Send either a catalogue id or a statement' })
      .parse(req.body);
    const statement = b.id ? graphCatalogue().find((q) => q.id === b.id)?.statement : b.statement;
    if (!statement) throw notFound('Query');
    const info = await syncInfo();
    res.json({ syncedAt: info.syncedAt, ...(await runExplorerQuery(statement)) });
  }),
);
