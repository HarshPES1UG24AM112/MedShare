# Phase 5: Testing and Optimisation

This phase re-ran every suite after the Phase 4 frontend integration, fixed the defects that integration exposed, and measured the platform's key queries on a scaled-up dataset. Indexes were added only where a measurement justified them; none was. The two changes that did pay off are a view/function migration and one query rewrite.

## 1. Test suites

| Suite | Command | Result |
|---|---|---|
| SQL integrity checks | `npm run db:test` | 77 checks pass (rolled back) |
| Multi-connection concurrency checks | `npm run db:test` | 22 checks pass, including reconciliation = 0 after every race |
| API integration (Vitest + Supertest, real PostgreSQL) | `npm test` | 55 tests pass (49 before Phase 5 plus 6 new regression tests) |
| Frontend unit and component tests | `npm test` in `frontend/` | 19 tests pass |
| Frontend type-check and production build | `npm run typecheck`, `npm run build` | pass |

### End-to-end verification in a browser (Phase 4)

The React app was run against the live API (Vite on :5173, API on :4000, PostgreSQL in Docker) and checked as three seeded users:

* **Full transfer**: `fac-002.inventory` raised a pull request for Omeprazole from FAC-001, starting from the shortage page. `fac-001.manager` saw it under "Needs my action", approved it (FAC-001 went from 2,910 available / 0 reserved to 1,302 / 1,608) and dispatched it (reserved 1,608 → 0). `fac-002.inventory` received it with 8 units damaged in transit. The ledger shows `TRANSFER_IN +1,600` and `TRANSIT_DAMAGE +8 (damaged bucket)`, both linked to the transfer, and the shortage moved from CRITICAL to LOW.
* **Scope**: `fac-001.manager` opening FAC-002's stock gets the server's 403 rendered as "Access restricted". FAC-002's facility page shows directory details only. `/audit` shows the permission page.
* **Expiry and shortages**: both pages render for each user, scoped to their facilities, with acknowledge, write-off, redistribute and source actions where the permissions allow them.
* **Layout**: all 22 routes at 375 px wide had zero horizontal page scroll after one fix (long filter options widened their `<select>`).
* **Errors**: no failed API calls in the session apart from the deliberate 403s.

Not verified in the browser: the organisation-admin and auditor UIs beyond the API tests, and the "Run engine" button (covered by the existing API test for `/redistribution/run` permissions).

## 2. Defects found and fixed

| # | Defect | Fix | Regression test |
|---|---|---|---|
| 1 | Dispense, damage, dispose, write-off and adjust accepted `Idempotency-Key` but ignored it. A client retrying after a lost response recorded the movement twice, contrary to API_CONTRACT §1. | Migration `008_idempotent_stock_actions.sql` adds `fn_stock_action`, a SECURITY DEFINER wrapper that applies `fn_idem_lookup`/`fn_idem_record` in the same transaction as the ledger entry. For a write-off of "everything", the quantity is resolved after the key lookup, so a retry still matches. | `catalogue-inventory.test.ts`: retried dispense records one movement; a reused key with another body returns 422; a key reused across actions returns 422 |
| 2 | `GET /transfers?actionable=true` ("Needs my action") listed the requester's own PENDING transfer, kept a transfer listed after its stage was decided, and never listed cross-organisation transfers awaiting the organisation stage. | The predicate now mirrors `allowedActions`: requester excluded, undecided stages only, `transfer:approve_org` for the organisation stage. | `transfers.test.ts`: two tests (own request; facility-then-organisation stage sequence) |
| 3 | A read-only auditor could acknowledge shortage and expiry alerts, which changes shared state. | Acknowledgement also requires `inventory:write` at the alert's facility. | `monitoring.test.ts`: auditor gets 403 and the alert stays OPEN |

All three are recorded in API_CONTRACT §4.

## 3. Query performance study

### Method

* `npm run perf:build` creates a disposable `medshare_perf` database: migrations 000–008, the normal seed, then `db/perf/scale.sql`. The scaled volumes are 2,009,776 movements, 223,838 inventory rows, 100,042 transfers, 36,190 batches, 14,884 stock policies, 9,050 medicines and 300 facilities. The bulk load runs with `session_replication_role = replica`, so ledger triggers do not fire and balances are set directly. That is fine for plan analysis, and the real database is never touched.
* `npm run perf:explain` runs each query exactly as the API sends it, as `medshare_app`, with `EXPLAIN (ANALYZE, BUFFERS)`. Each is measured on a warm cache after one discarded run. Each candidate (an index or a migration) is created **inside a transaction**, measured and rolled back, so "before" and "after" run on identical data. Full plans are in [`perf/EXPLAIN_RESULTS.md`](perf/EXPLAIN_RESULTS.md).

### Results (PostgreSQL 16, Docker on a laptop; milliseconds, representative run)

| Query | Before | Best candidate | After | Decision |
|---|---|---|---|---|
| Q1a search predicate (`/medicines?search=`) | 17 | trigram index on `code` | 13 | rejected: within noise, and 9 k rows fit in 166 buffers |
| Q1b full `/medicines` search request | 7,912 | migration 009 | 366 | **adopted** (22× faster) |
| Q2 FEFO sourcing (`/medicines/:id/sources`) | 589 | partial DISPENSE index | 431 | rejected: helps less than 009 and costs writes on the largest table |
|  |  | migration 009 | 303 | **adopted** |
|  |  | 009 + per-facility partner CTE | 43 | **adopted** (14× faster) |
| Q3a monthly consumption aggregation (materialized view refresh) | 2,130 | none | — | accepted: a daily job reading 2 M rows with an index-supported hash aggregate |
| Q3b monthly consumption analytics read | 89 | `(facility_id, month)` index on the materialized view | 57 | not adopted: about 30 ms on one of ~18 analytics sections; revisit if analytics latency matters |
| Q4a pending transfers, network | 4 | `transfer_items (transfer_id)` | 4 | rejected: `ix_transfers_status_created` already serves it |
| Q4b pending transfers, one facility | 3.5 | same | 3.6 | rejected |

### What the plans showed

* **Q1b**: the search predicate costs only 17 ms. The time was in the joined `v_medicine_availability`:
  * Building `v_inventory_detail` over 224 k rows took ~3 s. `fn_today()` was a VOLATILE wrapper around plpgsql `fn_now()`, evaluated six times per row (about 1.3 M calls).
  * The per-medicine correlated `facilities_short` subquery ran 9,050 times at 0.36 ms each.
* **Q2**: with VOLATILE `fn_today()` inside its CTE, `v_demand` could not be inlined, so demand was computed for all 14,884 stock policies (465 ms) before the medicine filter applied. With that fixed, ~260 ms remained in `fn_is_transfer_authorised` and `fn_distance_km` evaluated per candidate batch row (~1,800) instead of per partner facility.
* **Q3 and Q4**: already efficient. The existing composite and BRIN indexes and the materialized view do their job, so nothing new is justified.

### Changes adopted

* **Migration `009_query_performance.sql`**:
  * `fn_today()` becomes STABLE. That is one consistent "today" per statement, which is the correct semantics; `fn_now()` stays VOLATILE for exact event timestamps.
  * `v_inventory_detail` evaluates today once per query (InitPlan).
  * `v_medicine_availability` counts shortages with one grouped join.
  * View columns are unchanged.
* **`/medicines/:id/sources`** computes authorisation and distance once per partner facility in a `MATERIALIZED` CTE. Rows and order are unchanged; the existing sourcing API test passes.
* **Equivalence check**: `perf:explain` fingerprints every row of `v_medicine_availability`, `v_inventory_detail` and `v_shortage_status` (MD5 over ordered rows) before and after 009 on the scaled dataset. The fingerprints are identical.

### Not done (and why)

* No index migration: none of the candidates cleared the bar of a material improvement on a user-facing query without write cost on a hot table.
* `/medicines` at 9 k medicines still takes ~0.37 s, because it aggregates network stock for every medicine before paginating. A precomputed availability summary (a materialized view refreshed by the existing job) would make it constant-time, at the cost of staleness. That is a product decision, so it is noted here rather than implemented.
* Load testing (concurrent HTTP clients) was out of scope. Concurrency correctness is covered by the 22 multi-connection checks.
