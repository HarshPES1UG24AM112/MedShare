# API Integration

The frontend uses the MedShare REST API v1. **[`API_CONTRACT.md`](../../API_CONTRACT.md) at the repo root is the source of truth** for every path, body, response and error code; this document describes how the frontend consumes it. The provisional mock contract that the first frontend build used has been removed.

## Layers

| File | Role |
|---|---|
| `src/api/types.ts` | TypeScript types for every request and response: integer ids, camelCase keys, `{ data, meta }` pages, `{ id, code, name }` facility refs |
| `src/api/endpoints.ts` | Every path, relative to `VITE_API_BASE_URL` (`/api/v1`) |
| `src/api/client.ts` | Axios instance: bearer token, `ApiError` normalisation, the 401 broadcast |
| `src/api/services/types.ts` | `MedShareApi`, the interface hooks depend on |
| `src/api/services/http.ts` | The implementation; adds `Idempotency-Key` to stock and transfer writes |
| `src/hooks/queries.ts` | TanStack Query hooks, query keys and invalidation; the only layer components use |

Tests replace `@/api` with `vi.mock`; nothing else imports a fake.

## Authentication

* `POST /auth/login` returns `{ accessToken, tokenType, expiresIn, user: Me }`. The token is kept in `localStorage` (`medshare.accessToken`, guarded for blocked storage), and `Me` is kept in `AuthContext`.
* On reload, `GET /auth/me` restores the session; a failure clears the token.
* Any 401 (except on the login call itself) broadcasts `onUnauthorized`, which signs out and shows "Your session expired".
* There is no `/auth/register`: accounts are created by administrators (`POST /users`).

## Authorisation in the UI

The server is authoritative; the UI only decides what to **show**.

* `Me.permissions`: the union of the user's permissions. `can(user, p)` gates pages and global buttons (Users needs `user:manage`, Audit needs `audit:read`, Analytics needs `report:read`, "Add medicine" needs `catalogue:manage`, batch status changes need `batch:manage`).
* `Me.facilityPermissions[facilityId]`: per-facility permissions. `canAt(user, p, facilityId)` gates row actions: stock actions (`inventory:write`), stock-policy edits (`settings:manage`), "Source stock" / "Redistribute" / request lines (`transfer:request`), stock requests (`request:create`).
* **Transfers**: buttons come only from the server's `TransferDetail.allowedActions` (`approve: Stage[]`, `reject: Stage[]`, `cancel`, `dispatch`, `receive`). The frontend does not re-implement self-approval, the system-admin exclusion or the organisation stage.
* **Run engine** shows only for `ORG_ADMIN` or `SYSTEM_ADMIN` holding `recommendation:manage`.
* Every page renders the four states: loading, empty, error, and 403 ("Access restricted" from `ErrorState`, or `Forbidden` when the user lacks the page's permission).

## Facility scope

The top-bar selector lists `Me.scopeFacilityIds`. "All" sends no `facilityId`, and the server applies the whole scope. A selected facility is sent as `facilityId` to dashboard, inventory, alerts, transfers, stock-request and analytics calls. A remembered selection that is no longer in scope is ignored. A `facilityId` outside scope returns 403 from the server and is shown as "Access restricted", never silently widened.

Batch-level detail is shown only for in-scope facilities. The one purpose-bound exception is `GET /medicines/:id/sources?destinationFacilityId=`, used by the pull-transfer dialog to list eligible source batches anywhere in the network.

## Writes and idempotency

`receive`, the five stock actions, transfer create/approve/reject/cancel/dispatch/receive and recommendation accept send `Idempotency-Key: <uuid>`. Forms that create things (receipt, transfer request, recommendation accept, workflow actions) hold one key per attempt, so a retry after a network failure replays the original result instead of executing twice. After a definitive 4xx refusal the key is renewed, so the corrected request is new.

## Errors

The error body `{ error: { code, message, details?, requestId } }` becomes `ApiError(status, code, message, details)`. Messages are written for end users and shown verbatim, in the form's alert area or a toast. Field `details` are mapped onto form fields where the names match.

## Transfers in the UI

* **Request** (`POST /transfers`, never reserves stock):
  * **Pull**: the receiving facility is one where the user holds `transfer:request`. Pick a medicine, then a batch from `/medicines/:id/sources` (FEFO order, with distance, cross-organisation flag and source stock status). The first line fixes the source facility, and later lines are filtered to it. Lines can link to open stock-request items at the destination.
  * **Push**: the sending facility is one where the user holds `transfer:request`; batches come from `/inventory?facilityId=`.
* **Approve** reserves stock atomically once every required stage is approved. An `INSUFFICIENT_STOCK` failure leaves the transfer PENDING, and the message is shown.
* **Receive** sends `lines: [{ itemId, received, damaged }]` only when something was damaged; otherwise it sends no lines.
* **Timeline** shows `fromStatus → toStatus` (derived by the server with `LAG`) and time spent in each state.

## Query invalidation

Stock-affecting mutations invalidate the `dashboard`, `inventory`, `alerts`, `redistribution`, `analytics`, `medicines`, `facilities`, `batches`, `transfers`, `stock-requests`, `notifications` and `audit` keys, so every derived view refreshes. Reference lists (categories, units, substances, manufacturers, regions, organisations, roles) are cached for 10 minutes.

## Endpoint map

| Screen | Calls |
|---|---|
| Sign-in, session | `POST /auth/login`, `GET /auth/me` |
| Top bar | `GET /facilities`, `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /dashboard/summary` (sidebar counts) |
| Dashboard | `GET /dashboard/summary`, `/alerts/shortages`, `/alerts/expiry`, `/analytics/overview`, `/transfers`, `/inventory/movements` |
| Medicines | `GET /medicines`, `GET /medicines/:id`, `POST /medicines`, `GET /catalogue/categories`, `/catalogue/units`, `/catalogue/substances`, `/catalogue/manufacturers`, `GET /batches?medicineId=` |
| Batches | `GET /batches`, `GET /batches/:id`, `POST /batches/:id/status` |
| Stock | `GET /inventory`, `POST /inventory/receipts`, `POST /inventory/:id/{dispense,damage,dispose,write-off,adjust}`, `GET /inventory/movements?inventoryId=` |
| Movements | `GET /inventory/movements` |
| Facilities | `GET /facilities`, `/facilities/:id`, `/facilities/:id/summary`, `/facilities/:id/settings`, `PUT /facilities/:id/settings/:medicineId`, `GET /regions`, `GET /organizations` |
| Shortages, Expiry | `GET /alerts/shortages`, `/alerts/expiry`, `/alerts/expiry/summary`, `POST /alerts/{shortages,expiry}/:alertId/acknowledge` |
| Redistribution | `GET /redistribution/recommendations`, `POST /redistribution/run`, `POST …/:id/accept`, `POST …/:id/dismiss` |
| Stock requests | `GET /stock-requests`, `POST /stock-requests`, `POST /stock-requests/:id/cancel` |
| Transfers, history | `GET /transfers` (`status`, `facilityId`, `direction`, `actionable=true`), `GET /transfers/:id`, `POST /transfers`, `POST /transfers/:id/{approve,reject,cancel,dispatch,receive}`, `GET /medicines/:id/sources` |
| Analytics | `GET /analytics/overview` (`facilityId`, `months`, `medicineId`) |
| Users | `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `POST/DELETE /users/:id/roles…`, `POST/DELETE /users/:id/facility-roles`, `GET /organizations` |
| Audit | `GET /audit-logs` |
