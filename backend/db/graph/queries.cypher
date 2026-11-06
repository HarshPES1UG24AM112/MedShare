// MedShare graph query catalogue (Neo4j / Cypher).
// The graph is a read model rebuilt from PostgreSQL by `npm run graph:sync`;
// `npm run graph:queries` runs every query below. Paste any of them into
// Neo4j Browser (http://localhost:7474) to see the result drawn as a graph.
// All data is synthetic.
//
// Model
//   (:Facility)-[:BELONGS_TO]->(:Organisation)      (:Facility)-[:LOCATED_IN]->(:Region)-[:PART_OF]->(:Region)
//   (:Facility)-[:ROAD {km}]->(:Facility)            one per pair; distance is symmetric, so match it undirected
//   (:Facility)-[:CAN_SUPPLY {km, sameOrg}]->(:Facility)   a transfer request the database would accept
//   (:Organisation)-[:AGREEMENT {validFrom, validTo, inForce}]->(:Organisation)
//   (:Facility)-[:STOCKS {usable, reserved, nearestExpiry}]->(:Medicine)
//   (:Facility)-[:SHORT_OF {status, usable, daysOfCover, dailyRate, demandBasis}]->(:Medicine)
//   (:Facility)-[:SENT {transfers, units, lastReceivedAt}]->(:Facility)    completed deliveries

// G01: Network overview: what the graph holds
MATCH (n) WHERE NOT n:SyncInfo
RETURN labels(n)[0] AS label, count(*) AS nodes
ORDER BY label;

// G02: Distance between two facilities (an undirected relationship match)
MATCH (a:Facility {code: 'FAC-001'})-[r:ROAD]-(b:Facility {code: 'FAC-007'})
RETURN a.name AS from, b.name AS to, r.km AS km;

// G03: The five nearest facilities to Yelahanka CHC
MATCH (f:Facility {code: 'FAC-002'})-[r:ROAD]-(n:Facility)
RETURN n.code AS code, n.name AS facility, r.km AS km
ORDER BY km LIMIT 5;

// G04: Who may supply Yelahanka CHC: inside the source's radius, same organisation or an agreement in force
MATCH (s:Facility)-[c:CAN_SUPPLY]->(:Facility {code: 'FAC-002'})
MATCH (s)-[:BELONGS_TO]->(o:Organisation)
RETURN s.code AS code, s.name AS supplier, o.name AS organisation, c.km AS km, c.sameOrg AS sameOrganisation
ORDER BY km;

// G05: Every critical shortage paired with the nearest legal supplier that holds the medicine (one pattern, five hops)
MATCH (d:Facility)-[sh:SHORT_OF {status: 'CRITICAL'}]->(m:Medicine)<-[st:STOCKS]-(s:Facility)-[c:CAN_SUPPLY]->(d)
WITH d, m, sh, s, st, c ORDER BY c.km
WITH d, m, sh, collect({supplier: s.code, km: c.km, usable: st.usable})[0] AS nearest
RETURN d.code AS facility, m.name AS medicine, sh.daysOfCover AS daysOfCover, nearest.supplier AS supplier,
       nearest.km AS km, nearest.usable AS supplierUsable
ORDER BY daysOfCover, facility LIMIT 10;

// G06: Critical shortages that NO legal supplier can cover today (coverage gaps)
MATCH (d:Facility)-[:SHORT_OF {status: 'CRITICAL'}]->(m:Medicine)
WHERE NOT EXISTS { (m)<-[:STOCKS]-(:Facility)-[:CAN_SUPPLY]->(d) }
RETURN d.code AS facility, m.name AS medicine
ORDER BY facility, medicine;

// G07: Least-connected facilities: how many facilities may supply each one
MATCH (f:Facility {active: true})
RETURN f.code AS code, f.name AS facility, COUNT { ()-[:CAN_SUPPLY]->(f) } AS suppliers,
       COUNT { (f)-[:CAN_SUPPLY]->() } AS canSupply
ORDER BY suppliers, code LIMIT 5;

// G08: Shortest relay between two facilities that cannot trade directly (connectivity, not a MedShare feature: each hop would be its own transfer)
MATCH (a:Facility {code: 'FAC-009'}), (b:Facility {code: 'FAC-003'})
MATCH p = shortestPath((a)-[:CAN_SUPPLY*..4]->(b))
RETURN [n IN nodes(p) | n.code] AS route, length(p) AS hops, reduce(km = 0.0, r IN relationships(p) | km + r.km) AS km;

// G09: Busiest supply corridors from completed transfers
MATCH (s:Facility)-[t:SENT]->(d:Facility)
RETURN s.code AS fromCode, d.code AS toCode, t.transfers AS transfers, t.units AS unitsReceived
ORDER BY unitsReceived DESC LIMIT 5;

// G10: Organisation agreements in force (who may trade across organisations)
MATCH (a:Organisation)-[g:AGREEMENT {inForce: true}]->(b:Organisation)
RETURN a.name AS organisation, b.name AS partner, g.validFrom AS validFrom, g.validTo AS validTo
ORDER BY organisation, partner;

// G11: Usable Paracetamol rolled up to each district (variable-length PART_OF walk up the region tree)
MATCH (m:Medicine {code: 'MED-0001'})<-[s:STOCKS]-(:Facility)-[:LOCATED_IN]->(:Region)-[:PART_OF*0..]->(r:Region {level: 'DISTRICT'})
RETURN r.name AS district, count(*) AS facilities, sum(s.usable) AS usableUnits
ORDER BY usableUnits DESC;

// G12: Facilities within 25 km of Yelahanka CHC as the crow flies (spatial point.distance), beside the routed estimate
MATCH (a:Facility {code: 'FAC-002'}), (b:Facility)
WHERE a <> b AND point.distance(a.location, b.location) < 25000
MATCH (a)-[r:ROAD]-(b)
RETURN b.code AS code, b.name AS facility, round(point.distance(a.location, b.location) / 1000, 1) AS straightLineKm, r.km AS routedKm
ORDER BY straightLineKm;

// G13: Waste prevention: stock expiring within 60 days at one facility that a legal partner is short of
MATCH (s:Facility)-[st:STOCKS]->(m:Medicine)<-[sh:SHORT_OF]-(d:Facility)
WHERE (s)-[:CAN_SUPPLY]->(d) AND st.nearestExpiry < date() + duration({days: 60})
RETURN s.code AS holder, m.name AS medicine, st.usable AS usable, st.nearestExpiry AS expires, d.code AS shortFacility, sh.status AS status
ORDER BY expires, holder LIMIT 10;

// G14: The network as a picture: every legal supply link (returns paths, drawn as a graph)
MATCH p = (:Facility)-[:CAN_SUPPLY]->(:Facility)
RETURN p;

// G15: Which organisation runs which facility, and the agreements between organisations
MATCH p = (:Facility)-[:BELONGS_TO]->(:Organisation)
RETURN p
UNION ALL
MATCH p = (:Organisation)-[:AGREEMENT {inForce: true}]->(:Organisation)
RETURN p;

// G16: The shortest legal supply chain as a path (FAC-009 cannot supply FAC-003 directly)
MATCH (a:Facility {code: 'FAC-009'}), (b:Facility {code: 'FAC-003'})
MATCH p = shortestPath((a)-[:CAN_SUPPLY*..4]->(b))
RETURN p;

// G17: The region tree with its facilities (state › district › taluk)
MATCH p = (:Facility)-[:LOCATED_IN]->(:Region)-[:PART_OF*0..]->(:Region {level: 'STATE'})
RETURN p;

// G18: One facility's neighbourhood: its critical shortages and the nearby suppliers that hold them
MATCH p = (d:Facility {code: 'FAC-002'})-[:SHORT_OF {status: 'CRITICAL'}]->(m:Medicine)<-[:STOCKS]-(s:Facility)-[:CAN_SUPPLY]->(d)
RETURN p;
