# MedShare — Handoff: finish Phase 4, then Phases 5–6

You are continuing a university DBMS project, **MedShare**: a *simulated* medicine-inventory redistribution and shortage-prevention platform. The stack is PostgreSQL 16, Express + TypeScript, and React + TypeScript. Phases 1–3 are complete, tested and committed. Phase 4 (frontend integration) has only just started. **Read this whole file before changing anything.**

## 1. Where things are

* Repo: `E:\MedShare`, a git repository. The current branch is **`phase-4/integration`**, created from `agent-1/backend`, which contains every earlier commit.
* **Latest commit on this branch:** a new backend endpoint, `GET /api/v1/medicines/:id/sources?destinationFacilityId=` in `backend/src/modules/catalogue.routes.ts`, plus its test in `backend/tests/transfers.test.ts` (11/11 transfer tests pass). The working tree is clean. Phase 4's frontend work starts from here.
* **First-time setup on a new machine:** `.env` is not shipped. Copy `.env.example` to `.env` in the repo root. Its placeholder values are mutually consistent and work for local development; change the passwords and `JWT_SECRET` if you like, before running `db:reset`. The database isn't shipped either: it's rebuilt from migrations and the deterministic seed.
* Git identity is already set in the repo: `Dhareen <dhareengnanashekar@gmail.com>`. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push, and don't merge into `main`.
* Secrets live in the **root** `E:\MedShare\.env`, which is git-ignored; the template is `.env.example`. Never commit `.env`.

### Read these first (they are the source of truth)

| File | Why |
|---|---|
| `API_CONTRACT.md` (repo root) | **Every endpoint, request and response shape, error code, and auth/scope rule.** Section 3 lists the differences from the old frontend contract. |
| `backend/docs/PHASE1_DATABASE_DESIGN.md` | Requirements, ER model, functional dependencies, normalisation, transaction and concurrency design, redistribution engine |
| `backend/docs/PHASE2_IMPLEMENTATION.md` | What the database contains: procedures, triggers, views, privileges, seed, tests |
| `backend/README.md` | Setup, scripts, demo accounts |
| `frontend/docs/*.md`, `frontend/README.md` | The frontend as built against **mock data** (these need updating in Phase 4) |

## 2. Run it

Docker Desktop must be running.

```bash
cd E:/MedShare/backend
npm install
npm run db:up        # PostgreSQL 16 on localhost:5433 (container medshare-postgres)
npm run db:reset     # migrations 000–007 + deterministic synthetic seed (~20 s); ends by asserting reconciliation = 0
npm run db:test      # 99 checks (77 SQL integrity + 22 multi-connection concurrency) — must stay green
npm test             # API integration tests (Vitest + Supertest, dedicated medshare_api_test DB) — must stay green
npm run dev          # API → http://localhost:4000/api/v1

cd ../frontend
npm install
npm run dev          # Vite → http://localhost:5173 (proxies /api to :4000)
```

Demo accounts (synthetic) all use the password `MedShare@2026`:

| Account | Role |
|---|---|
| `admin@medshare.health` | system administrator |
| `auditor@medshare.health` | platform auditor |
| `org1.admin@medshare.health` … `org5.admin@…` | organisation administrators |
| `org2.auditor@medshare.health` | auditor scoped to one organisation |
| `fac-001.manager@medshare.health` … `fac-015.manager@…` | facility managers |
| `fac-001.inventory@medshare.health` … `fac-015.inventory@…` | inventory managers |

## 3. Non-negotiable design rules (already implemented — preserve them)

* PostgreSQL is the foundation. Inventory balances change **only** through the `inventory_movements` ledger trigger. `medshare_app` (the API's database role) has no direct write access to inventory, the ledger or transfers; it calls `SECURITY DEFINER` procedures, which re-check permissions inside the database.
* Transfers: request (no reservation) → **approve reserves stock atomically** (with an extra organisation stage for cross-organisation transfers) → dispatch → receive. Reject applies to PENDING only; cancel applies to PENDING or APPROVED and releases the reservation. Requesters can't approve their own transfers, and `SYSTEM_ADMIN` can't approve at all.
* Scope: a client-supplied `facilityId` is always checked. Batch-level detail is visible only for in-scope facilities. The new `/medicines/:id/sources` endpoint is the single, purpose-bound exception for sourcing a transfer into your own facility.
* Migrations are checksummed: **never edit an applied migration** (000–007). Add `008_*.sql` instead.
* Don't fake features or data. Label synthetic data. Never claim something works unless it's implemented and tested.

## 4. Phase 4 — what remains

The frontend (`frontend/`) still runs on a **mock layer** (`src/api/mock/*`, `VITE_USE_MOCKS`) whose shapes match the *old* provisional contract. Integrate it with the real API.

1. **API layer.** Rewrite `src/api/types.ts`, `endpoints.ts`, `services/types.ts` and `services/http.ts` to match `API_CONTRACT.md`: integer IDs, camelCase, `{ data, meta }` pagination, nested `{ id, code, name }` facility refs, and the `Idempotency-Key` header on stock and transfer writes. **Delete the mock layer** (`src/api/mock/`, its test, `VITE_USE_MOCKS`, and the "Demo data" badge). `client.ts` (ApiError, token handling, the 401 broadcast) can mostly stay, because the error body shape is the same.
2. **Auth.** Login returns `{ accessToken, user: Me }`. Remove `RegisterPage` and its route, since there's no self-registration. Show the demo-account panel only when `import.meta.env.DEV` is true. Rewrite `auth/permissions.ts` around `Me.permissions` / `Me.facilityPermissions`. For transfers, use the server's `allowedActions`; don't re-implement those rules. `FacilityScope`: the selector lists `Me.scopeFacilityIds`, and "All" means the whole scope.
3. **Labels.** Five roles (`SYSTEM_ADMIN`, `ORG_ADMIN`, `FACILITY_MANAGER`, `INVENTORY_MANAGER`, `AUDITOR`), the `PHARMACY` facility type, the `SUSPENSION`/`DROPS` dosage forms, the new movement types, and the demand-basis labels (`MEASURED`, `ESTIMATED_SIMULATED`, `ESTIMATED_CONFIGURED`, plus `possiblyCensored`).
4. **Adapt the existing pages to the real endpoints:**
   * **Dashboard:** `/dashboard/summary`; shortage and expiry panels; inventory distribution from `/analytics/overview`; recent transfers and movements.
   * **Medicines:** list filters plus an add-medicine form with an **ingredients editor** (substance autocomplete from `/catalogue/substances`); detail page with ingredients, manufacturers, stock by facility and batches.
   * **Inventory:**
     * scoped list and receive stock
     * per-row actions on separate endpoints: dispense, damage, dispose, write-off, adjust
     * stock history from `/inventory/movements?inventoryId=`
   * **Movements**
   * **Facilities:** directory; detail with summary (only when `inScope`) and a **stock-policy settings** tab (`PUT /facilities/:id/settings/:medicineId`, `settings:manage`).
   * **Shortages:** severity tabs, demand basis, acknowledge, and a "Source stock" button that opens the request modal.
   * **Expiry:** windows plus summary, write-off and redistribute.
   * **Redistribution:** accept (this creates a PENDING transfer; navigate to it) and dismiss. Show "Run engine" only for ORG_ADMIN or SYSTEM_ADMIN.
   * **Analytics:** add region availability, recurring shortages, wastage, redistribution potential, transfer timing and top consumed with month-over-month change. Show the synthetic-data banner from `meta.synthetic`.
   * **Audit**
5. **Transfer request modal: multi-item.**
   * **Pull** (into your facility): choose the destination from facilities where you hold `transfer:request` → medicine → pick a batch from `/medicines/:id/sources` → quantity.
   * **Push** (out of your facility): pick batches from `/inventory?facilityId=`.
   * Every item must share one source facility. Lines may link to stock-request items.
6. **Transfer detail modal.** Show required stages, approvals, the timeline (`fromStatus` via LAG), the items, and action buttons driven by `allowedActions`. Receiving takes per-line received and damaged quantities, and rejecting requires a reason.
7. **New pages your spec requires:**
   * **Batch management** (`/batches`, holdings, status change for system admins)
   * **Transfer history** (RECEIVED, REJECTED and CANCELLED transfers, with the timeline)
   * **Transfer management** (active transfers, plus a "Needs my action" filter via `actionable=true`)
   * **User management** (`/users`: create with roles and facility roles, activate or deactivate, grant or revoke)
   * **Stock requests** (`/stock-requests`: list, create, cancel; derived received and in-progress quantities)
   * A **notifications** bell in the top bar (`/notifications`, mark as read)
8. **Frontend tests.** Replace the mock-based tests. Mock the API module with `vi.mock` for the login page, and keep the permissions and format tests. `npm run typecheck`, `npm test` and `npm run build` must all pass.
9. **Verify in a real browser against the running API.** Test as `admin`, as `fac-001.manager` and as `fac-002.inventory`:
   * a full transfer from request to receipt
   * expiry and shortage pages
   * scope restrictions
   * no horizontal scroll at 375 px
10. **Update `frontend/README.md` and `frontend/docs/*`.** `API_INTEGRATION.md` should now describe the real integration. Then commit.

Keep the existing design system: white and light-grey surfaces, navy text, subtle green, minimal shadows, every chart with a legend and a table view, and all four states (loading, empty, error, 403) on every page.

## 5. Then Phase 5 (testing & optimisation) and Phase 6 (documentation)

* **Phase 5:**
  * Record `EXPLAIN (ANALYZE, BUFFERS)` before and after for at least four queries (trigram medicine search, FEFO sourcing, monthly consumption, pending transfers) on a scaled-up dataset, and add indexes in a new migration only if they're justified.
  * Re-run every suite.
  * Fix bugs.
* **Phase 6:**
  * Root `README.md`: overview, problem, objectives, stack, architecture, installation, environment, API docs (link to `API_CONTRACT.md`), schema, ER diagram, screenshots, testing.
  * `DBMS_DOCUMENTATION.md` with the 14 sections from the original brief. Reuse the Phase 1 and 2 documents, and include at least 20 meaningful SQL queries: joins, aggregates, nested and correlated subqueries, window functions, CTEs, recursive CTEs, GROUP BY/HAVING, date analytics.
  * A university demonstration walkthrough.

Work in that order. Report what you verified, and be explicit about anything you couldn't.
