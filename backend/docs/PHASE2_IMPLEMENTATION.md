# MedShare — Phase 2: Database Implementation

**Status:** complete. Everything below runs on PostgreSQL 16 (Docker) and is covered by `npm run db:test` (**99 automated checks, all passing**).
Design rationale: [PHASE1_DATABASE_DESIGN.md](PHASE1_DATABASE_DESIGN.md).

> All data is **synthetic**. Organisations, facilities, users and manufacturers carry `is_synthetic = true` and "(Synthetic)" in their names. Nothing represents real institutions, stock or patients.

---

## 1. What exists

| Object | Count | Where |
|---|---|---|
| Tables | 35 | `db/migrations/001_schema.sql` |
| Named integrity constraints (mapped to API errors) | 17, plus every PK/FK/UNIQUE/CHECK | `001_schema.sql` |
| Indexes (B-tree, partial, covering, GIN trigram, BRIN) | 102 | `001_schema.sql`, `005_views.sql` |
| Triggers | 33 | `003_triggers.sql` |
| Stored procedures (`CREATE PROCEDURE`) | 8 | `004_procedures.sql` |
| Functions (core, ledger, jobs, engine, trigger functions) | 54 | `002_core.sql`, `003`, `004`, `005` |
| Views / materialized views | 14 / 1 | `005_views.sql` |
| Database roles | 3 (`medshare_owner`, `medshare_app`, `medshare_readonly`) | `000_bootstrap.sql`, `006_privileges.sql` |

### Migrations

| File | Contents |
|---|---|
| `000_bootstrap.sql` | Runs as superuser and is idempotent. Creates the roles, hands the `public` schema to `medshare_owner`, sets the timezone, and revokes the default `EXECUTE` from PUBLIC. |
| `001_schema.sql` | Types, 35 tables, keys, constraints, indexes, the `movement_types` reference data, code sequences, `COMMENT ON` dictionary. |
| `002_core.sql` | Event clock `fn_now()`, actor context, `fn_fail()` error convention, RBAC reference data (5 roles, 17 permissions, matrix), `fn_user_has_permission`, partner authorisation, distance, idempotency, audit and notification helpers. |
| `003_triggers.sql` | Ledger → balance, inventory guard, append-only tables, transfer state machine + history, shortage-threshold alerts, audit of significant changes, role-scope / hierarchy-cycle / composition / recommendation checks. |
| `004_procedures.sql` | Transfer workflow, ledger entry points, stock requests, recommendation dismissal, reconciliation, expiry and shortage jobs, the redistribution engine. |
| `005_views.sql` | Region and category trees (recursive), catalogue, inventory detail, facility stock, demand (measured vs estimated), shortage status, expiring inventory, summaries, pending transfers, transfer timeline (`LAG`/`LEAD`), organisation analytics, `mv_monthly_consumption`. |
| `006_privileges.sql` | Least-privilege grants (§4). |

The runner (`scripts/db.ts`) applies migrations in order. It applies `000` as superuser and every later file under `SET LOCAL ROLE medshare_owner`, so objects and `SECURITY DEFINER` routines are owned by a non-superuser. Each file is one transaction. Applied files are checksummed in `schema_migrations`, and editing an applied file is refused.

---

## 2. Routines

### Stock & transfer procedures (all `SECURITY DEFINER`, permission-checked inside, optional idempotency key)

| Routine | Effect |
|---|---|
| `fn_create_transfer_request(actor, source, destination, items, notes, recommendation_id, idem_key)` | Validates route, partner authorisation, distance, cold chain, batch eligibility and advisory availability. Creates a **PENDING** transfer and **does not reserve**. Optionally links stock-request lines and accepts a recommendation. |
| `sp_approve_transfer(actor, transfer, stage, comment, idem_key, INOUT status)` | Locks the transfer row. Checks state, stage permission, self-approval and agreement validity. Records the stage approval. When every required stage is approved, calls `sp_reserve_transfer_inventory` and sets APPROVED. |
| `sp_reserve_transfer_inventory(transfer, actor)` | Locks the source inventory rows in id order (`FOR UPDATE OF i FOR SHARE OF b`), re-checks eligibility and availability under the lock, and writes RESERVE movements. All or nothing. |
| `sp_reject_transfer(actor, transfer, reason, stage, …)` | PENDING only; reason required. |
| `sp_cancel_transfer(actor, transfer, reason, …)` | PENDING or APPROVED. An APPROVED transfer releases its reservation (RELEASE movements). |
| `sp_dispatch_transfer(actor, transfer, note, …)` | Refuses batches recalled, quarantined or expired since approval. Writes TRANSFER_OUT (reserved → out). |
| `sp_receive_transfer(actor, transfer, lines, note, …)` | Creates destination inventory rows race-safely. Writes TRANSFER_IN plus TRANSIT_DAMAGE. Closes fully received stock requests (correlated subquery). |
| `sp_receive_stock(…)` | Goods receipt: creates the batch on first sight or checks it matches; rejects expired batches. |
| `fn_record_dispense`, `fn_record_damage`, `fn_dispose_damaged`, `fn_write_off_expired`, `fn_adjust_stock` | Single-row ledger operations through the shared `fn_ledger_entry`, which locks, checks permission, eligibility and stock, then inserts the movement. |
| `fn_set_batch_status` | Quarantine, recall or re-activate a batch network-wide (platform permission). Audited; notifies holding facilities. |
| `fn_create_stock_request`, `fn_cancel_stock_request`, `fn_dismiss_recommendation` | Request and recommendation lifecycle. |
| `fn_reconcile_inventory(facility?)` / `sp_reconcile_inventory` | Lists every discrepancy: balance vs ledger (×3 buckets), reserved vs open approved transfer items, received vs TRANSFER_IN. Zero rows means consistent. |
| `fn_generate_expiry_alerts()`, `fn_refresh_shortage_alerts()`, `fn_refresh_analytics()` | Scheduled jobs. These are time-driven, so they're functions, not triggers. |
| `fn_generate_recommendations(actor?)` | Redistribution engine (design §10). Phase A covers shortages FEFO-first, then nearest. Phase B handles near-expiry excess using a FEFO consumption model. Advisory only. |

### Error convention

Business errors are raised with a custom SQLSTATE class plus a stable code in `HINT`. The API maps them one-to-one:

| SQLSTATE | HTTP | Example HINT codes |
|---|---|---|
| `MS403` | 403 | `FORBIDDEN`, `SELF_APPROVAL`, `PARTNER_NOT_AUTHORISED`, `INVENTORY_DIRECT_WRITE`, `APPEND_ONLY` |
| `MS404` | 404 | `TRANSFER_NOT_FOUND`, `BATCH_NOT_FOUND`, `INVENTORY_NOT_FOUND` |
| `MS409` | 409 | `INVALID_STATE`, `STAGE_ALREADY_DECIDED`, `BATCH_RECALLED`, `DUPLICATE_MEDICINE` |
| `MS422` | 422 | `INSUFFICIENT_STOCK`, `BATCH_NOT_ELIGIBLE`, `BATCH_EXPIRED`, `REASON_REQUIRED`, `RECEIPT_MISMATCH`, `IDEMPOTENCY_KEY_REUSED`, `OUT_OF_RANGE`, `COLD_CHAIN_REQUIRED` |
| `23514` / `23505` / `23P01` | 422 / 409 | named constraints such as `ck_inventory_available_nonneg`, `uq_batch_lot`, `ex_agreement_no_overlap` |

---

## 3. Triggers

| Trigger | Table | Purpose |
|---|---|---|
| `trg_inventory_movements_apply` | inventory_movements (BEFORE INSERT) | Applies `quantity × movement_types.effect_*` to the balance. Enforces the transfer-item and reason requirements. **The only write path to balances.** |
| `trg_inventory_guard` | inventory | New rows must be zero. UPDATE is allowed only from the ledger trigger (`pg_trigger_depth() > 1`). DELETE is forbidden. Applies to superusers too. |
| `trg_*_append_only`, `trg_*_no_truncate` | movements, audit_logs, transfer_status_history, transfer_approvals | Blocks UPDATE, DELETE and TRUNCATE |
| `trg_transfer_state_validate` | transfer_requests | Legal transitions only; route, code, requester and creation time immutable; inserts must be PENDING |
| `trg_transfer_history` | transfer_requests (AFTER) | Writes status history with the actor. Refuses changes with no actor. |
| `trg_inventory_threshold`, `trg_settings_threshold`, `trg_batch_status_threshold` | inventory, settings, batches | Open, escalate, de-escalate or resolve shortage alerts (upsert on a partial unique index); notify managers when a shortage becomes critical |
| `trg_audit_inventory_change`, `trg_audit_batch_status` | movements, batches | Audit losses, corrections and large movements; batch status changes |
| `trg_validate_role_grant` | user_roles, facility_users | Role granted at a level allowed by `roles.grant_level` |
| `trg_*_no_cycle` | regions, medicine_categories | Recursive-CTE cycle check |
| `trg_*_composition` (deferred constraint triggers) | medicines, medicine_ingredients | At least one ingredient; no duplicate form + composition |
| `trg_recommendation_validate` | redistribution_recommendations | Source ≠ destination |
| `trg_*_touch` | 9 tables | `updated_at` |

---

## 4. Privileges

| | `medshare_app` (API) | `medshare_readonly` |
|---|---|---|
| Read | All tables and views | Views only |
| Master data | INSERT/UPDATE on users, organisations, agreements, facilities, regions, catalogue tables, settings; INSERT/DELETE role grants | — |
| Stock, ledger, transfers, batches, requests, recommendations, idempotency | **No direct writes.** Only `EXECUTE` on the routines in §2. | — |
| Audit log | INSERT only (UPDATE/DELETE blocked by privilege and trigger) | — |
| Alerts / notifications | UPDATE of acknowledgement / `read_at` columns only | — |

The concurrency suite verifies this with a real `medshare_app` connection: direct writes to inventory, movements, audit logs and transfer status all fail with `42501`, and the app cannot back-date events.

---

## 5. Synthetic seed

`npm run db:seed` (or `db:reset`) generates a deterministic network (seeded PRNG; dates relative to today) **by driving the real procedures chronologically**, with `medshare.event_time` back-dating each step. Only a superuser session can do this; `fn_now()` ignores the setting for the app role. Nothing is inserted around the ledger, so balances, alerts and analytics are internally consistent, and the seed ends by asserting **reconciliation = 0**.

| Entity | Seeded |
|---|---|
| Organisations | 5 (public health network, hospital trust, pharmacy cooperative, medical depot, NGO) |
| Facilities | 15 across a Karnataka region tree (state › 6 districts › 11 taluks) |
| Users | 38: system admin, platform auditor, 5 org admins, 1 org-scoped auditor, a manager and an inventory manager per facility. Password `MedShare@2026`. |
| Agreements | 6 (one lapsed, to demonstrate expiry) |
| Medicines | 50, including 7 combination products, 5 cold-chain items, and aspirin 75 mg vs 300 mg in different categories |
| Batches | 150 (3 per medicine: expired / near-expiry, mid-life, long-dated) from 6 manufacturers |
| Inventory rows | ≈ 1,840 |
| Movements | ≈ 9,800 (receipts, 6 months of FEFO dispensing, damage, disposal, write-offs, transfer movements) |
| Stock policies | 634 (≈ 100 with estimated demand: one recently onboarded facility, plus censored demand after stock-outs) |
| Transfers | 42: received, rejected, cancelled, and in-flight pending / approved / in transit; 25 same-organisation, 17 cross-organisation |
| Stock requests | 22 (open, closed by receipt) |
| Batch status | 1 quarantined, 1 recalled |
| Jobs run at the end | expiry alerts, shortage alerts, recommendations, materialized view refresh |

Exact counts vary slightly by run date, because expiry windows are relative to today.

---

## 6. Test results (`npm run db:test`)

**SQL integrity suite** (`db/tests/001_integrity.sql`): 77 checks. It builds its own fixtures in one transaction and rolls back, so it never modifies seeded data.

| Area | What is proven |
|---|---|
| Ledger | Receipt updates balance + movement + audit. Direct UPDATE/DELETE/INSERT on inventory rejected (even as superuser). Movements and audit log append-only (UPDATE/DELETE/TRUNCATE). Reason / transfer-item requirements. Negative stock rejected by CHECK. Failed operations leave balances unchanged. |
| Lifecycle | Request doesn't reserve; approve reserves atomically; dispatch clears reservation; receipt adds the *same batch* at the destination; 4 history rows with `LAG()` previous status; RESERVE → TRANSFER_OUT → TRANSFER_IN ledger; every step audited; double receive and dispatch-after-receive rejected. |
| Contention & rollback | Second reservation exceeding stock fails and rolls back entirely (no approval row, still PENDING). A multi-item approval with one short line reserves nothing. |
| Authorisation | Inventory manager, destination manager and system admin cannot approve; auditor cannot receive stock; other-facility staff cannot dispense; self-approval blocked; partner without agreement blocked; read scoping via `fn_user_facility_ids`. |
| Rules | State-machine transitions, immutable route, actor required; reject needs a reason; expired / < 14-day batches can't be transferred; expired stock can't be dispensed and can be written off; recall after approval blocks dispatch and cancel releases the reservation; only platform admins recall. |
| Idempotency | Same key returns the same transfer; same key with a different payload rejected; retried dispatch is a no-op; receipt lines must add up; transit damage lands in the damaged bucket. |
| Alerts & engine | Shortage alert open → resolve → LOW → escalate to CRITICAL (single open alert); expiry job idempotent; engine creates no transfers and never violates eligibility, authorisation, radius, cold chain or quantity. |
| Cross-row integrity | Role scope, hierarchy cycle, medicine without ingredients, duplicate composition, overlapping agreements, threshold order. |
| Reconciliation | 0 discrepancies; a movement inserted with the ledger trigger disabled is detected. |

**Concurrency suite** (`scripts/concurrency.ts`): 22 checks with real parallel connections on a throwaway database.

| Scenario | Result |
|---|---|
| Two facilities reserve the same stock at once (documented example, design §9.2) | Session 2 **blocks** on the row lock; after session 1 commits it re-reads 30 units and fails with `INSUFFICIENT_STOCK`; reserved 70 ≤ 100; loser fully rolled back |
| 20 concurrent approvals for 100 units (10 each) | **Exactly 10 succeed, 10 fail**; available 0, reserved 100 |
| Two concurrent dispatches of one transfer | One wins, one gets `INVALID_STATE`; exactly one TRANSFER_OUT |
| Two concurrent retries with the same idempotency key | One transfer; the loser gets `23505` on `idempotency_keys_pkey`; a later retry returns the stored transfer |
| Opposite-order row locks | PostgreSQL aborts one with `40P01`; `withRetry()` retries and succeeds |
| SERIALIZABLE with a stale snapshot | Second writer aborted with `40001`; the retry sees 40 units and is refused |
| App-role privileges | Direct writes denied (`42501`); event back-dating ignored |
| After all races | Reconciliation 0 |

---

## 7. Refinements made during implementation

Testing and seeding surfaced these improvements over the Phase 1 text. All of them are reflected in the code, and the design document was updated where relevant.

1. **Reject only from PENDING.** An approved transfer is *cancelled* instead, which releases its reservation. That keeps one decision row per stage (`UNIQUE (transfer_id, stage)`).
2. **Actor context is cleared** right after each status change (`fn_clear_actor()`). The test suite found that a transaction-local actor set by a procedure could otherwise leak to a later raw statement in the same transaction.
3. **Censored demand.** A stocked-out facility dispenses nothing, so its measured demand reads 0. `v_demand` falls back to the estimate in that case and flags `possibly_censored`. Without this, the engine under-served exactly the facilities that needed stock.
4. **Event clock.** Every event default uses `fn_now()`, which honours `medshare.event_time` only for superuser sessions. This makes back-dated synthetic history possible without giving the API any way to forge timestamps.
5. **Constraint names.** The 17 constraints the API maps to error codes are named explicitly (`ck_inventory_available_nonneg`, `uq_batch_lot`, `ex_agreement_no_overlap`, …).

---

## 8. Next: Phase 3 (backend)

Express + TypeScript API on top of this database: JWT auth (bcrypt), RBAC middleware using `fn_user_has_permission` / `fn_user_facility_ids`, Zod validation, procedure calls with `withRetry()` and `Idempotency-Key`, mapping of the error convention, Prisma (`db pull`) for master-data CRUD, and publication of `API_CONTRACT.md` for the frontend.
