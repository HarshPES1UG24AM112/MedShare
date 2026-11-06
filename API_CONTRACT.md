# MedShare API Contract (v1)

**Owner:** backend (Agent 1). **Consumer:** frontend (Agent 2).
**Base URL:** `/api/v1` (the dev server runs at `http://localhost:4000/api/v1`; the Vite dev proxy forwards `/api`).
**Status:** implemented and covered by 55 integration tests against PostgreSQL (`backend/tests`). Changes since approval are listed in §4.

> MedShare is a simulated platform. Seeded data is synthetic, and analytics responses say so in `meta.synthetic`.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Format | JSON in and out. Keys are **camelCase**. |
| IDs | **Integers** (JSON numbers). Codes such as `FAC-001`, `MED-0001` and `TRF-2026-00012` are human-readable unique keys. |
| Dates | Calendar dates (`expiryDate`, `manufactureDate`, `neededBy`) are `YYYY-MM-DD` strings. Timestamps are ISO-8601 with timezone. |
| Quantities | Integers, in the medicine's issue unit. |
| Auth | `Authorization: Bearer <accessToken>` on every endpoint except `POST /auth/login` and `GET /health`. Tokens are HS256 JWTs, expiring after 8 h by default. |
| Request id | Every response carries `X-Request-Id`, which also appears in error bodies and audit entries. |
| Idempotency | Stock and transfer writes accept an `Idempotency-Key: <uuid>` header. A retry with the same key and body returns the original result without re-executing. The same key with a different body returns 422 `IDEMPOTENCY_KEY_REUSED`. |

### Pagination, search and sorting (all list endpoints marked *paged*)

Query parameters: `page` (default 1), `pageSize` (default 20, max 100), `search`, `sortBy` (from each endpoint's whitelist), `sortDir=asc|desc`.

```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

### Errors

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Only 30 units of batch PAR2411-0004 are available; 60 requested",
             "details": { "quantity": ["…"] }, "requestId": "…" } }
```

| HTTP | Typical `code` |
|---|---|
| 400 | `BAD_REQUEST` (malformed JSON or path parameter, bad Idempotency-Key) |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `SELF_APPROVAL`, `PARTNER_NOT_AUTHORISED` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND`, `TRANSFER_NOT_FOUND` |
| 409 | `INVALID_STATE`, `STAGE_ALREADY_DECIDED`, `BATCH_RECALLED`, `BATCH_QUARANTINED`, `DUPLICATE_MEDICINE`, `EMAIL_TAKEN`, `OVERLAPPING_AGREEMENT`, `RECOMMENDATION_NOT_OPEN` |
| 422 | `VALIDATION` (with `details` per field), `INSUFFICIENT_STOCK`, `BATCH_NOT_ELIGIBLE`, `BATCH_EXPIRED`, `BATCH_NOT_EXPIRED`, `REASON_REQUIRED`, `RECEIPT_MISMATCH`, `OUT_OF_RANGE`, `COLD_CHAIN_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` |
| 429 | `RATE_LIMITED` (10 login attempts per minute per IP) |
| 503 | `CONCURRENCY_RETRY_EXHAUSTED` (after automatic deadlock/serialization retries) |

`message` is written for end users and can be shown verbatim.

### Authorisation model

* **Roles:** `SYSTEM_ADMIN` (platform), `ORG_ADMIN` (organisation), `FACILITY_MANAGER` and `INVENTORY_MANAGER` (facility), `AUDITOR` (platform or organisation). A user can hold several roles.
* **Scope:** `scopeFacilityIds` from `/auth/me` lists the facilities whose operational detail the user may read. Any `facilityId` filter outside that scope returns 403, never silently ignored. Platform administrators and platform auditors see the whole network.
* **Network visibility:** everyone can see the facility directory and medicine-level network totals. Batch-level inventory, movements and stock-policy settings are scope-checked.
* **Writes:** permission is re-checked inside the database for every stock and transfer operation. The `facilityPermissions` map from `/auth/me` is for showing or hiding UI controls only.
* **Segregation of duties:** a requester cannot approve their own transfer, and `SYSTEM_ADMIN` cannot approve transfers.

---

## 2. Endpoints

### Health & auth

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/health` | — | `{ status, database, serverTime, schema }` |
| POST | `/auth/login` | `{ email, password }` | `{ accessToken, tokenType, expiresIn, user: Me }` |
| GET | `/auth/me` | — | `Me` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` (10+ chars, upper, lower, digit) | 204 |

`Me = { id, email, fullName, roles: [{ role, organizationId, organizationName }], facilities: [{ facilityId, facilityCode, facilityName, role }], scopeFacilityIds: number[], platformScope: boolean, permissions: string[], facilityPermissions: { [facilityId]: string[] } }`

There is **no self-registration**: administrators create accounts (`POST /users`).

### Users (`user:manage`; org admins are limited to their organisation)

| Method | Path | Notes |
|---|---|---|
| GET | `/users` *paged* | filters: `role`, `facilityId`, `organizationId`, `active`; sort: `name`, `email`, `lastLogin`, `createdAt` |
| GET | `/users/:id` | `{ id, email, fullName, isActive, roles: [{ grantId, role, organizationId, organizationName }], facilities: [{ facilityId, facilityCode, facilityName, role }] }` |
| POST | `/users` | `{ email, fullName, password, roles?: [{ role, organizationId|null }], facilities?: [{ facilityId, role }] }` → 201 |
| PATCH | `/users/:id` | `{ fullName?, isActive? }` (you cannot deactivate yourself) |
| POST | `/users/:id/roles` | `{ role, organizationId|null }` |
| DELETE | `/users/:id/roles/:grantId` | |
| POST | `/users/:id/facility-roles` | `{ facilityId, role: FACILITY_MANAGER|INVENTORY_MANAGER }` |
| DELETE | `/users/:id/facility-roles` | `{ facilityId, role }` |

### Organisations, regions, facilities, stock policy

| Method | Path | Notes |
|---|---|---|
| GET | `/regions` | `[{ id, parentId, code, name, depth, level: STATE|DISTRICT|TALUK, path }]` (level derived recursively) |
| GET | `/organizations` | with `facilityCount` |
| POST / PATCH | `/organizations`, `/organizations/:id` | `organization:manage` (system admin) |
| GET | `/organizations/agreements` | `[{ id, organizationAId/Name, organizationBId/Name, validFrom, validTo, inForce }]` |
| POST | `/organizations/agreements` | `{ organizationAId, organizationBId, validFrom, validTo? }`; overlapping periods return 409 |
| GET | `/facilities` *paged* (default 100) | filters: `type`, `organizationId`, `regionId` (includes sub-regions); each row has `inScope` |
| GET | `/facilities/:id` | facility + `inScope` |
| GET | `/facilities/:id/summary` | scope-checked. `{ usableUnits, reservedUnits, damagedUnits, usableValue, medicinesInStock, batchesOnHand, expiredBatches, expiring30dBatches, criticalShortages, lowStock, … }` |
| POST / PATCH | `/facilities`, `/facilities/:id` | `facility:manage` for the organisation |
| GET | `/facilities/:id/settings` *paged* | stock policy per medicine: `minStockLevel, reorderThreshold, safetyStock, estimatedDailyConsumption, estimateIsSimulated, measuredDailyConsumption, dailyRate, demandBasis, possiblyCensored, usable, daysOfInventory, stockStatus` |
| PUT | `/facilities/:id/settings/:medicineId` | `settings:manage` at the facility; `{ minStockLevel, reorderThreshold, safetyStock, estimatedDailyConsumption, estimateIsSimulated? }` |

`demandBasis` is `MEASURED` (derived from dispensing history), `ESTIMATED_SIMULATED` or `ESTIMATED_CONFIGURED`. `possiblyCensored = true` means no dispensing in the window, probably because of a stock-out, so the estimate is used instead.

### Catalogue & batches

| Method | Path | Notes |
|---|---|---|
| GET | `/medicines` *paged* | `search` matches name, code, **substance** or **manufacturer**; filters: `categoryId` (includes descendants), `dosageForm`, `essential`, `coldChain`, `manufacturerId`, `active`; sort: `name`, `code`, `category`, `form`, `networkUsable`, `facilitiesShort` |
| GET | `/medicines/:id` | medicine + `ingredients[]` + `manufacturers[]` + `stockByFacility[]` (in-scope facilities) |
| POST | `/medicines` | `catalogue:manage`; `{ code?, name, dosageForm, unitVolumeMl?, categoryId, dispensingUnitId, requiresColdChain?, isEssential?, description?, ingredients: [{ substanceId? \| substanceName?, strengthValue, strengthUom }] }`; duplicate composition returns 409 `DUPLICATE_MEDICINE` |
| PATCH | `/medicines/:id` | partial; `ingredients` replaces the composition |
| GET | `/catalogue/categories` | tree rows `{ id, parentId, name, depth, path, medicineCount }` |
| POST | `/catalogue/categories` | `{ name, parentId? }` |
| GET | `/catalogue/units`, `/catalogue/substances?search=`, `/catalogue/manufacturers` | lookups |
| POST | `/catalogue/manufacturers` | `{ name, licenseNumber, country? }` |
| GET | `/batches` *paged* | filters: `medicineId`, `manufacturerId`, `status`, `expiryBucket`, `onHandOnly`; rows include `daysToExpiry`, `expiryBucket`, `networkOnHand`, `facilitiesHolding` |
| GET | `/batches/:id` | batch + `holdings[]` (in-scope facilities) |
| POST | `/batches/:id/status` | `batch:manage` (system admin); `{ status: ACTIVE|QUARANTINED|RECALLED, reason }` |

Medicine rows: `{ id, code, name, strengthLabel, displayName, dosageForm, unitVolumeMl, unit, categoryId, category, categoryPath, requiresColdChain, isEssential, isActive, substances, networkUsable, facilitiesHolding, facilitiesShort, nearestExpiry }`.

### Inventory (scope-checked; writes need `inventory:write` at the row's facility)

| Method | Path | Notes |
|---|---|---|
| GET | `/inventory` *paged* | filters: `facilityId`, `medicineId`, `batchId`, `expiryBucket`, `batchStatus`, `onHandOnly` (default true); sort: `medicine`, `facility`, `batchNumber`, `expiryDate`, `available`, `reserved`, `damaged`, `value`, `updatedAt` |
| GET | `/inventory/:id` | one row |
| GET | `/inventory/movements` *paged* | filters: `facilityId`, `medicineId`, `batchId`, `inventoryId`, `type`, `from`, `to`; rows have signed `deltaAvailable/deltaReserved/deltaDamaged`, `transferCode`, `performedByName` |
| POST | `/inventory/receipts` | goods receipt. `{ facilityId, medicineId, manufacturerId, batchNumber, manufactureDate, expiryDate, unitCost, quantity, reference? }` → 201 inventory row (creates the batch on first receipt) |
| POST | `/inventory/:id/dispense` | `{ quantity, reference? }` |
| POST | `/inventory/:id/damage` | `{ quantity, reason }` |
| POST | `/inventory/:id/dispose` | `{ quantity, reason }` (damaged stock) |
| POST | `/inventory/:id/write-off` | `{ quantity?, reason? }`; expired batches only |
| POST | `/inventory/:id/adjust` | `{ delta (≠ 0), reason }` |

Inventory row: `{ inventoryId, facilityId, facilityCode, facilityName, organizationId, batchId, batchNumber, medicineId, medicineCode, medicineName, manufacturer, manufactureDate, expiryDate, unitCost, batchStatus, qtyAvailable, qtyReserved, qtyDamaged, updatedAt, daysToExpiry, expiryBucket, isUsable, availableValue }`.

### Alerts & notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/alerts/shortages` *paged* | filters: `facilityId`, `severity` (CRITICAL/LOW), `medicineId`; rows: `currentStock, minStockLevel, reorderThreshold, avgDailyConsumption, demandBasis, possiblyCensored, daysRemaining, deficit, coverage, alertId, alertStatus`; sort: `daysRemaining`, `coverage`, `deficit`, `medicine`, `facility`, `currentStock` |
| GET | `/alerts/expiry` *paged* | `window=expired|7|30|60` (default 30), `facilityId`; inventory rows + `valueAtRisk`, `alertId` |
| GET | `/alerts/expiry/summary` | `{ expired, within7, within30, within60, unitsAtRisk, valueAtRisk, expiredValue }` |
| POST | `/alerts/shortages/:alertId/acknowledge`, `/alerts/expiry/:alertId/acknowledge` | scope-checked and needs `inventory:write` at the alert's facility; OPEN → ACKNOWLEDGED |
| GET | `/notifications` *paged* | `unreadOnly`; also returns `unreadCount` |
| POST | `/notifications/:id/read`, `/notifications/read-all` | 204 |

### Redistribution

| Method | Path | Notes |
|---|---|---|
| GET | `/redistribution/recommendations` *paged* | filters: `facilityId` (source or destination), `reasonCode`, `status` (default OPEN); sort: `priorityScore`, `distanceKm`, `expiryDate`, `quantity`, `reduction` |
| POST | `/redistribution/run` | regenerates recommendations from a REPEATABLE READ snapshot. Needs an organisation or platform role with `recommendation:manage`. → `{ generated }` |
| POST | `/redistribution/recommendations/:id/accept` | `{ quantity?, notes? }` → 201 `{ transferId, recommendationId }`. Creates a **PENDING** transfer; it never executes one. |
| POST | `/redistribution/recommendations/:id/dismiss` | `{ reason }` |

Recommendation: `{ id, generatedAt, reasonCode: SHORTAGE_COVER|NEAR_EXPIRY_SURPLUS, recommendedQuantity, projectedShortageReduction, priorityScore, explanation, sourceFacility{id,code,name}, destinationFacility{…}, medicine{id,code,name,strengthLabel}, batch{id,batchNumber,expiryDate,quantityAvailable}, expiryDate, daysToExpiry, distanceKm, crossOrganization, stale }`. `stale` means stock has changed since generation; approval re-validates in any case.

### Transfers

| Method | Path | Notes |
|---|---|---|
| GET | `/transfers` *paged* | filters: `status`, `facilityId`, `direction=incoming|outgoing` (relative to `facilityId`), `actionable=true` (only transfers waiting on the caller: a stage they may still approve, excluding their own requests, or dispatch / receive); sort: `createdAt`, `updatedAt`, `code`, `status`, `totalUnits` |
| GET | `/transfers/:id` | `TransferDetail` |
| POST | `/transfers` | `{ sourceFacilityId, destinationFacilityId, items: [{ batchId, quantity, stockRequestItemId? }], notes? }` → 201. **Does not reserve stock.** |
| POST | `/transfers/:id/approve` | `{ stage?: SOURCE_FACILITY|SOURCE_ORGANIZATION, comment? }`. When every required stage is approved, stock is **reserved atomically**; an `INSUFFICIENT_STOCK` failure leaves the transfer PENDING. |
| POST | `/transfers/:id/reject` | `{ stage?, reason }` (PENDING only) |
| POST | `/transfers/:id/cancel` | `{ reason }` (PENDING or APPROVED; approved transfers release their reservation) |
| POST | `/transfers/:id/dispatch` | `{ note? }` (refuses batches recalled, quarantined or expired since approval) |
| POST | `/transfers/:id/receive` | `{ lines?: [{ itemId, received, damaged }], note? }`; omit `lines` if everything arrived intact |

All workflow responses return the updated `TransferDetail`:

```
TransferDetail = {
  id, code, status: PENDING|APPROVED|DISPATCHED|RECEIVED|REJECTED|CANCELLED, createdAt, updatedAt,
  sourceFacility{id,code,name}, destinationFacility{id,code,name}, crossOrganization, requestedBy{id,name},
  requestNotes, rejectionReason, recommendationId, itemCount, totalUnits, medicines,
  requiredStages: ['SOURCE_FACILITY'] | ['SOURCE_FACILITY','SOURCE_ORGANIZATION'],
  items: [{ id, batchId, batchNumber, expiryDate, batchStatus, daysToExpiry, medicineId, medicineName, strengthLabel, unit,
            quantity, quantityReceived, quantityDamagedInTransit, sourceAvailable, sourceReserved, stockRequestItemId }],
  approvals: [{ stage, decision, comment, decidedAt, decidedBy{id,name} }],
  timeline:  [{ step, fromStatus, toStatus, note, changedAt, timeInState, changedBy{id,name} }],
  allowedActions: { approve: Stage[], reject: Stage[], cancel: boolean, dispatch: boolean, receive: boolean }
}
```

### Stock requests

| Method | Path | Notes |
|---|---|---|
| GET | `/stock-requests` *paged* | filters: `status`, `facilityId`, `priority`; `items[]` include derived `quantityReceived` and `quantityInProgress` |
| POST | `/stock-requests` | `{ facilityId, priority?, neededBy?, notes?, items: [{ medicineId, quantity }] }` |
| POST | `/stock-requests/:id/cancel` | `{ reason }` |

A request closes automatically when every line has been fully received through linked transfers.

### Dashboard & analytics

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/summary?facilityId=` | `{ totalFacilities, registeredMedicines, medicinesInStock, totalInventoryUnits, criticalShortages, lowStock, expiringBatches30d, expiredBatchesOnHand, pendingTransfers, awaitingDispatch, inTransit, openRecommendations, openStockRequests, unreadNotifications, scope }` |
| GET | `/analytics/overview?facilityId=&months=3..24&medicineId=` | one REPEATABLE READ snapshot: `inventoryDistribution, expiryTrend (12 months), shortageRisk, recurringShortages, transferStats, transferStatusBreakdown, transferTiming, transferCompletionRate, movementTrend, stockByCategory, availabilityByRegion (recursive rollup; filter with medicineId), expiryRisk, wastage, redistribution, monthlyConsumption, topConsumedLastMonth, demandBasis, meta{ synthetic, note, months, scope }` |

### Network (graph read model)

Answered from Neo4j, which is rebuilt from PostgreSQL (see [DBMS_DOCUMENTATION §15](DBMS_DOCUMENTATION.md#15-nosql-the-graph-database-neo4j)). Every route needs a signed-in user. When Neo4j is not configured or unreachable they answer `503 GRAPH_UNAVAILABLE`; before the first sync, `503 GRAPH_NOT_SYNCED`.

| Method | Path | Notes |
|---|---|---|
| GET | `/network/status` | never fails: `{ configured, reachable, syncedAt, source, nodes{label: n}, relationships{type: n}, error? }` |
| GET | `/network/graph` | `{ syncedAt, source, facilities[{ id, code, name, type, lat, lon, coldChain, radiusKm, active, organizationId, regionName, suppliers, canSupply, criticalShortages, lowShortages }], organisations[], supplyLinks[{ source, destination, km, sameOrg }], roads[{ a, b, km }], corridors[{ source, destination, transfers, units, lastReceivedAt }] }`. `criticalShortages`/`lowShortages` are `null` outside the caller's scope; `corridors` only include deliveries with either end in scope. |
| GET | `/network/distance?from=&to=` | `{ from, to, routedKm, straightLineKm, fromCanSupplyTo, toCanSupplyFrom, supplyChain: { facilities[], hops, km } \| null }`. `routedKm` = `fn_distance_km` (great-circle × 1.3); `supplyChain` is the shortest chain of supply links (up to 4 hops). Same facility twice → 422. |
| GET | `/network/queries` | platform-wide accounts only (403 otherwise). The documented Cypher catalogue: `[{ id: 'G01', title, statement }]`. |
| POST | `/network/queries/run` | platform-wide accounts only. Body `{ id }` (a catalogue query) **or** `{ statement }` (≤ 4,000 chars). → `{ syncedAt, columns[], rows[][], truncated, ms, graph: { nodes[{ id, labels, properties }], relationships[{ id, type, start, end, properties }] } }`. A cell holding a node is `{ node, labels, properties }`, a relationship `{ relationship, type, properties }`, a path `{ path: [codes], length }`. Runs in a READ transaction with a 5 s timeout and a 1,000-row cap. 422 `READ_ONLY` (would write), `CYPHER_NOT_ALLOWED` (`CALL` procedure, `LOAD CSV`, `SHOW`, `USE`), `CYPHER_ERROR` (syntax), `QUERY_TIMEOUT`. |
| GET | `/network/facilities/:id/suppliers?medicineId=` | scope-checked (403 outside scope). `{ syncedAt, facilityId, medicineId, suppliers[{ id, code, name, type, coldChain, organizationName, km, sameOrg, usable, nearestExpiry }] }`, nearest first; with `medicineId`, only suppliers holding it. |

### Audit & administration

| Method | Path | Notes |
|---|---|---|
| GET | `/audit-logs` *paged* | `audit:read`. Filters: `entityType`, `entityId`, `action`, `actorId`, `facilityId`, `from`, `to`. Organisation-scoped auditors see their facilities only. Read-only: no endpoint changes audit entries. |
| POST | `/admin/reconciliation` | `report:read`; `{ facilityId? }` → `{ count, discrepancies[], isolation: 'REPEATABLE READ' }` |
| GET / PATCH | `/admin/engine-config` | read: any signed-in user; update: system admin |
| POST | `/admin/jobs/:job` | system admin; `expiry-alerts`, `shortage-alerts`, `recommendations`, `analytics-refresh`, `graph-sync` (rebuilds the Neo4j graph; returns `{ syncedAt, nodes, relationships }`) |
| GET | `/admin/roles` | roles with their permissions |

---

## 3. Changes from the frontend's provisional contract (`frontend/docs/API_INTEGRATION.md`)

| Area | Provisional | Final |
|---|---|---|
| IDs | strings | integers |
| Roles | ADMIN, FACILITY_MANAGER, PHARMACIST, VIEWER (one per user) | five scoped roles, several per user; use `facilityPermissions` |
| Registration | `POST /auth/register` | removed; administrators create users |
| Transfer request | reserves stock | reserves at **approval** |
| Transfer shape | single batch | `items[]` (multi-batch); `requiredStages`; `allowedActions` |
| Reject vs cancel | reject from PENDING or APPROVED | reject PENDING only; cancel PENDING or APPROVED |
| Batch | copied per facility | global lot (`/batches`) + per-facility inventory rows |
| Medicine strength | string | `ingredients[]` + composed `strengthLabel` |
| Stock adjustments | `POST /inventory/batches/:id/adjustments` with `type` | one endpoint per action under `/inventory/:id/…` |
| Expiry params | `window=expired|7|30|60` | same |
| Shortages | `severity`, `daysRemaining` | same, plus `demandBasis`, `possiblyCensored`, `coverage`, `alertId` |
| Analytics | flat sections | superset (adds region rollup, recurring shortages, wastage, timing) |

---

## 4. Changes after approval (Phase 5)

All changes are backwards compatible for well-behaved clients; no path, field or shape changed.

| Endpoint | Change | Reason |
|---|---|---|
| `POST /inventory/:id/{dispense,damage,dispose,write-off,adjust}` | `Idempotency-Key` is now honoured (it was accepted but ignored). Same key + same body replays without a second movement; same key + different body → 422 `IDEMPOTENCY_KEY_REUSED`. | §1 already promised idempotency for every stock write. Migration `008_idempotent_stock_actions.sql`. |
| `POST /alerts/*/:alertId/acknowledge` | Also requires `inventory:write` at the alert's facility (403 otherwise). | Acknowledging changes shared state; read-only auditors could do it. |
| `GET /transfers?actionable=true` | Excludes the caller's own PENDING requests and stages already decided; includes cross-organisation transfers awaiting the caller's organisation stage. | It now matches `allowedActions` exactly. |
| `GET /medicines/:id/sources` | Same rows and order; evaluated per partner facility. | 591 → 43 ms on the scaled dataset (`backend/docs/perf/EXPLAIN_RESULTS.md`). |

---

## 5. Additions (graph database)

New, additive endpoints; nothing existing changed.

| Endpoint | Change | Reason |
|---|---|---|
| `GET /network/status`, `/network/graph`, `/network/distance`, `/network/facilities/:id/suppliers` | New, read-only, answered from Neo4j | The project needed a NoSQL database; the facility network is a graph. |
| `POST /admin/jobs/graph-sync` | New job name | Rebuild the graph on demand from PostgreSQL. |
| `GET /network/queries`, `POST /network/queries/run` | New: read-only Cypher for platform-wide accounts | The in-app Query explorer. |

