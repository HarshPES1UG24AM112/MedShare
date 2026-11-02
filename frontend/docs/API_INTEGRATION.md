# API Integration

**Owner:** Agent 2 (frontend) · **Counterpart:** Agent 1 owns `API_CONTRACT.md`, which is the source of truth.

> **Status — PROVISIONAL.** When the frontend was built, the repository had no `API_CONTRACT.md` and no backend.
> Every endpoint below is what the frontend **currently expects**, written up as a proposal for Agent 1.
> Once `API_CONTRACT.md` is published, this document will be reconciled against it, and the frontend will adapt to the contract, not the other way round.

---

## 1. How the frontend talks to the API

```
component ──► hooks/queries.ts (TanStack Query) ──► api (MedShareApi interface)
                                                     ├── services/http.ts  ← Axios → Agent 1's REST API
                                                     └── mock/mockApi.ts   ← in-browser synthetic data
```

* `src/api/index.ts` is the **only** place that chooses an implementation, based on `VITE_USE_MOCKS`.
* `src/api/endpoints.ts` holds **every URL path**. If the contract renames a path, only this file changes.
* `src/api/types.ts` holds **every request/response shape**. If the contract changes a field, update the type and fix the compiler errors.
* No component imports Axios, URLs or mock code.

### Switching to the real backend

```bash
# frontend/.env.local
VITE_USE_MOCKS=false
VITE_API_BASE_URL=/api/v1          # proxied by Vite in dev
VITE_PROXY_TARGET=http://localhost:4000
```

Or run `npm run dev:api` (loads `.env.api`).

---

## 2. Cross-cutting conventions the frontend assumes

| Concern | Expectation |
|---|---|
| Base path | `/api/v1` |
| Auth | `Authorization: Bearer <accessToken>` on every request except login/register |
| Token | JWT (or opaque) returned by login/register as `accessToken`; stored in `localStorage` |
| 401 | Session is ended client-side and the user is sent to `/login` with a "session expired" notice |
| 403 | The page or action shows "Access restricted" with the server's message |
| Dates | ISO-8601. Pure dates (`expiryDate`, `manufactureDate`) as `YYYY-MM-DD`; timestamps with timezone |
| IDs | Strings (UUID or cuid). The frontend never parses them |
| Quantities | Integers, in the medicine's issue unit |

### Pagination (all list endpoints marked *paginated*)

Query: `page` (1-based), `pageSize` (≤ 100), `search`, `sortBy`, `sortDir=asc|desc`, plus endpoint filters.

```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

### Error body

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Only 120 units are available in batch AMX-2231.", "details": { "quantity": ["Maximum 120"] } } }
```

* `message` is shown to the user verbatim in toasts, so it should be human-readable.
* `details` keys that match form field names are shown inline under those fields.
* Codes the UI already handles: `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `VALIDATION`, `DUPLICATE`, `INSUFFICIENT_STOCK`, `BATCH_EXPIRED`, `BATCH_NOT_EXPIRED`, `INVALID_STATE`, `FORBIDDEN`, `NOT_FOUND`.

---

## 3. Endpoints

Types are named after `src/api/types.ts`.

### Auth

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/auth/login` | `LoginInput { email, password }` | `AuthResponse { accessToken, user: User }` |
| POST | `/auth/register` | `RegisterInput { name, email, password, facilityId, role }` (role ≠ ADMIN) | `AuthResponse` |
| GET | `/auth/me` | — | `User` |

`User = { id, name, email, role: ADMIN | FACILITY_MANAGER | PHARMACIST | VIEWER, facilityId | null, facilityName? }`

### Dashboard

| GET | `/dashboard/summary` | `facilityId?` | `DashboardSummary` |
|---|---|---|---|

`DashboardSummary = { totalFacilities, totalMedicines, totalInventoryUnits, criticalShortages, lowStock, expiringBatches30d, expiredBatches, pendingTransfers }`. With `facilityId` set, every figure is scoped to that facility. `totalInventoryUnits` counts **usable** stock (available, non-expired).

### Facilities

| Method | Path | Response |
|---|---|---|
| GET | `/facilities` | `Facility[]` (unpaginated, expected < 500) |
| GET | `/facilities/:id` | `Facility` |
| GET | `/facilities/:id/summary` | `FacilitySummary { facility, totalUnits, batchCount, medicineCount, criticalShortages, lowStock, expiringIn30Days, expired }` |

### Medicines

| Method | Path | Query / Body | Response |
|---|---|---|---|
| GET | `/medicines` *paginated* | `category?`, `dosageForm?`, `essentialOnly?`; sort: `name, category, code, reorderThreshold` | `Paginated<Medicine>` |
| GET | `/medicines/categories` | — | `string[]` |
| GET | `/medicines/:id` | — | `MedicineDetail` (= `Medicine` + `totalAvailable` + `stockByFacility[]`) |
| POST | `/medicines` | `CreateMedicineInput` | `Medicine` (201) |

### Inventory

| Method | Path | Query / Body | Response |
|---|---|---|---|
| GET | `/inventory/batches` *paginated* | `facilityId?`, `medicineId?`, `status? = OK \| EXPIRING \| EXPIRED`; sort: `medicine, facility, expiryDate, quantityAvailable, quantityReserved, quantityDamaged, receivedAt` | `Paginated<Batch>` |
| POST | `/inventory/batches` | `ReceiveBatchInput { facilityId, medicineId, batchNumber, manufactureDate, expiryDate, quantity, unitCost }` | `Batch` (201) |
| POST | `/inventory/batches/:id/adjustments` | `StockAdjustmentInput { type: DISPENSE \| DAMAGE \| CORRECTION \| WRITE_OFF, quantity, direction?, reason }` | updated `Batch` |
| GET | `/inventory/movements` *paginated* | `facilityId?`, `medicineId?`, `batchId?`, `type?`; sort: `createdAt, quantity, medicine` | `Paginated<InventoryMovement>` |

`status=EXPIRING` means 0–60 days to expiry. `InventoryMovement.quantity` is **signed** (+ adds to available stock).

### Alerts

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/alerts/shortages` *paginated* | `facilityId?`, `severity? = CRITICAL \| LOW`; sort: `daysRemaining, currentStock, medicine, facility, coverage` | `Paginated<Shortage>` |
| GET | `/alerts/expiry` *paginated* | `window = expired \| 7 \| 30 \| 60` (required), `facilityId?`; sort: `daysToExpiry, quantityAvailable, medicine, facility, value` | `Paginated<ExpiringBatch>` |
| GET | `/alerts/expiry/summary` | `facilityId?` | `ExpirySummary { expired, within7, within30, within60, unitsAtRisk }` |

`Shortage.daysRemaining = floor(currentStock / avgDailyConsumption)`, or `null` when there's no consumption. `coverage` sorts by `currentStock / reorderThreshold`.

### Redistribution

| GET | `/redistribution/recommendations` *paginated* | `facilityId?` (source **or** destination), `reasonCode?`; sort: `priorityScore, distanceKm, expiryDate, suggestedQuantity` | `Paginated<Recommendation>` |
|---|---|---|---|

`Recommendation = { id, sourceFacility, destinationFacility, medicine, batch { id, batchNumber, quantityAvailable }, suggestedQuantity, expiryDate, distanceKm, reasonCode, reason, priorityScore (0–100) }`. The frontend assumes recommendations that already have an open transfer (via `recommendationId`) are excluded.

### Transfers

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/transfers` *paginated* | `status?`, `facilityId?`, `direction? = incoming \| outgoing` (relative to `facilityId`); sort: `createdAt, updatedAt, quantity, medicine` | `Paginated<Transfer>` |
| GET | `/transfers/:id` | — | `Transfer` (including `history[]`) |
| POST | `/transfers` | `CreateTransferInput { batchId, destinationFacilityId, quantity, notes?, recommendationId? }` | `Transfer` (201, status `PENDING`) |
| POST | `/transfers/:id/approve` | `{ note? }` | `Transfer` |
| POST | `/transfers/:id/reject` | `{ reason }` (required) | `Transfer` |
| POST | `/transfers/:id/dispatch` | `{ note? }` | `Transfer` |
| POST | `/transfers/:id/receive` | `{ note? }` | `Transfer` |
| POST | `/transfers/:id/cancel` | `{ note? }` | `Transfer` |

**Stock semantics the UI displays (please confirm):**

| Transition | Source batch | Destination |
|---|---|---|
| create → PENDING | `available −= q`, `reserved += q` | — |
| reject / cancel | `available += q`, `reserved −= q` | — |
| dispatch → DISPATCHED | `reserved −= q`; movement `TRANSFER_OUT` | — |
| receive → RECEIVED | — | batch with the same batch number created or incremented; movement `TRANSFER_IN` |

**Permissions the UI assumes** (mirrored in `src/auth/permissions.ts`, used only to hide controls):

| Action | Allowed |
|---|---|
| approve / reject | ADMIN, or FACILITY_MANAGER of the **source** facility |
| dispatch | ADMIN, or non-viewer staff at the source |
| receive | ADMIN, or non-viewer staff at the destination |
| cancel | ADMIN, or the requester, while PENDING |
| create | any non-viewer, and the source or destination must be the user's facility (ADMIN: any) |

Invalid transitions should return **409 `INVALID_STATE`**.

### Analytics

| GET | `/analytics/overview` | `facilityId?`, `months? = 3 \| 6 \| 12` | `AnalyticsOverview` |
|---|---|---|---|

`AnalyticsOverview = { inventoryDistribution[], expiryTrend[] (YYYY-MM, units, batches; 2 past + 10 future months), shortageRisk[] (top 10), transferStats[] (per month), transferStatusBreakdown[], transferCompletionRate (0–1), movementTrend[] (inbound / outbound / losses per month), stockByCategory[] }`.

`inventoryDistribution` is requested without `facilityId` so the chart can compare facilities.

### Audit logs (ADMIN only)

| GET | `/audit-logs` *paginated* | `entityType?`, `action?`, `userId?`, `from?`, `to?` (dates, inclusive); sort: `timestamp, user, action, entityType` | `Paginated<AuditLog>` |
|---|---|---|---|

---

## 4. Open questions for Agent 1

1. **Registration facility list.** `/register` needs the facility list before the user has a token. Can `GET /facilities` be public, or will there be a public `GET /facilities/public` (id + name only)?
2. **Write-off.** The UI sends `type: "WRITE_OFF"` on adjustments for expired batches and expects an `EXPIRED_WRITE_OFF` movement. Is that acceptable, or should it be a separate endpoint?
3. **Thresholds.** The UI shows per-facility `reorderThreshold` / `criticalThreshold` on shortages, and catalogue-level thresholds on medicines. Are thresholds stored per facility–medicine, or scaled from catalogue values?
4. **Token refresh.** Is there a refresh token, or should the UI just re-authenticate on 401? (It currently re-authenticates.)
5. **Recommendation IDs.** Are they stable between requests, so `recommendationId` on a transfer can hide that recommendation?
6. **Tab counts.** The Transfers page makes `pageSize=1` calls per status to get counts. A `GET /transfers/counts?facilityId=` endpoint would replace three calls with one.
7. **Analytics months.** Does `months` apply to `transferStats` and `movementTrend` only (the current assumption)?

---

## 5. Integration checklist (Phase 8)

- [ ] Agent 1 publishes `API_CONTRACT.md`
- [ ] Diff it against sections 3–4 and update `endpoints.ts` / `types.ts`
- [ ] Run `npm run typecheck`; fix every compile error the type changes cause
- [ ] Run the mock-API test expectations (`src/api/mock/mockApi.test.ts`) manually against the real API, checking stock semantics and permissions
- [ ] Set `VITE_USE_MOCKS=false`; smoke-test every page as each of the four roles
- [ ] Remove the demo-account panel's dependency on mock mode, if the real API provides seed users
