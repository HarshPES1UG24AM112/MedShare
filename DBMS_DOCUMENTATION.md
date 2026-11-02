# MedShare: DBMS Documentation

This document collects everything about MedShare's database in one place. It summarises and links the detailed design ([Phase 1](backend/docs/PHASE1_DATABASE_DESIGN.md)) and implementation ([Phase 2](backend/docs/PHASE2_IMPLEMENTATION.md)) documents rather than repeating them, and adds the query catalogue, performance evidence and test results from Phases 4–5.

> All data is synthetic. Nothing represents real institutions, stock or patients.

| § | Section |
|---|---|
| 1 | [Introduction and problem statement](#1-introduction-and-problem-statement) |
| 2 | [Requirements](#2-requirements) |
| 3 | [Entity-relationship model](#3-entity-relationship-model) |
| 4 | [Relational schema and data dictionary](#4-relational-schema-and-data-dictionary) |
| 5 | [Functional dependencies](#5-functional-dependencies) |
| 6 | [Normalisation (1NF → BCNF)](#6-normalisation-1nf--bcnf) |
| 7 | [Integrity constraints](#7-integrity-constraints) |
| 8 | [Indexing and query optimisation](#8-indexing-and-query-optimisation) |
| 9 | [Views and materialized views](#9-views-and-materialized-views) |
| 10 | [Stored procedures and functions](#10-stored-procedures-and-functions) |
| 11 | [Triggers](#11-triggers) |
| 12 | [Transactions, concurrency and isolation](#12-transactions-concurrency-and-isolation) |
| 13 | [SQL query catalogue (24 queries)](#13-sql-query-catalogue) |
| 14 | [Security, auditing, testing and limitations](#14-security-auditing-testing-and-limitations) |

---

## 1. Introduction and problem statement

Facilities in the same district often hold the wrong stock at the same time: one is short of an essential medicine while a nearby facility holds surplus that will soon expire. MedShare is a coordination platform: it detects shortages and near-expiry stock, recommends redistribution, and runs an audited, approval-gated transfer workflow.

The database is the system of record **and** the enforcement point:
* balances change only through a ledger;
* the transfer state machine, permission checks and reservation logic run inside PostgreSQL;
* the API's database role cannot bypass any of it.

That choice is deliberate. It makes the integrity guarantees independent of application bugs, and it makes the DBMS concepts (constraints, triggers, procedures, isolation) carry real weight rather than being decorative.

## 2. Requirements

The full specification is in [Phase 1 §1](backend/docs/PHASE1_DATABASE_DESIGN.md#1-requirements-specification). In summary:

* **Actors**: system administrator, organisation administrator, facility manager, inventory manager, auditor (platform- or organisation-scoped). A user can hold several roles.
* **Functional**:
  * catalogue with multi-ingredient medicines;
  * batch tracking and per-facility inventory (available / reserved / damaged);
  * receipts, dispensing, damage, disposal, expiry write-off, adjustments;
  * shortage alerts from measured or estimated demand, and expiry alerts at 7 / 30 / 60 days;
  * redistribution recommendations requiring human approval;
  * stock requests;
  * transfers (request → per-stage approval with atomic reservation → dispatch → receipt with transit damage; reject and cancel);
  * analytics; audit log.
* **Non-functional**: no negative stock, no double allocation, no expired-batch allocation, exactly-once API retries, least privilege, full auditability, deterministic synthetic data, sub-second reads on realistic volumes.

## 3. Entity-relationship model

The ER diagram (crow's foot) is in **[`ER_DIAGRAM.md`](ER_DIAGRAM.md)**, and the entity identification table is in [Phase 1 §3](backend/docs/PHASE1_DATABASE_DESIGN.md#3-entity-identification). The structurally important choices:

* **Facility × Batch → `inventory`** resolves an M:N relationship and carries the three balances. A batch is a global physical lot, not a per-facility copy, so a transferred lot keeps its identity.
* **Medicine ↔ Substance → `medicine_ingredients`** (M:N with strength) makes combination products first-class. The display strength is derived, never stored.
* **Recursive hierarchies**: `regions` (state › district › taluk) and `medicine_categories` reference themselves.
* **Event entities**: `inventory_movements`, `transfer_status_history` and `audit_logs` are append-only histories, so "current state" is never the only record.
* **Associative entities with attributes**: `organization_agreements` (validity period), `facility_medicine_settings` (stock policy), `stock_request_fulfilments` (request line ↔ transfer line).

## 4. Relational schema and data dictionary

There are 35 tables, all 21 mandated plus 14 that normalisation or a requirement made necessary. The data dictionary (attributes, primary, foreign and candidate keys, constraints and purpose of every relation) is [Phase 1 §5](backend/docs/PHASE1_DATABASE_DESIGN.md#5-relational-schema--data-dictionary). The authoritative DDL, with `COMMENT ON` for every table, is [`backend/db/migrations/001_schema.sql`](backend/db/migrations/001_schema.sql).

| Group | Tables |
|---|---|
| Identity and access | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `facility_users` |
| Network | `organizations`, `organization_agreements`, `regions`, `facilities` |
| Catalogue | `medicine_categories`, `medicine_units`, `substances`, `medicines`, `medicine_ingredients`, `manufacturers`, `medicine_batches` |
| Stock | `inventory`, `movement_types`, `inventory_movements`, `facility_medicine_settings`, `engine_config` |
| Demand and redistribution | `stock_requests`, `stock_request_items`, `redistribution_recommendations` |
| Transfers | `transfer_requests`, `transfer_items`, `stock_request_fulfilments`, `transfer_approvals`, `transfer_status_history` |
| Monitoring and accountability | `expiry_alerts`, `shortage_alerts`, `notifications`, `audit_logs`, `idempotency_keys` |

Keys: surrogate identity primary keys everywhere, plus the natural candidate keys enforced as UNIQUE (`facilities.code`, `(manufacturer_id, medicine_id, batch_number)`, `(facility_id, batch_id)`, …). The reasoning is in [Phase 1 §8.7](backend/docs/PHASE1_DATABASE_DESIGN.md#87-keys-surrogate-identity-columns--natural-candidate-keys).

## 5. Functional dependencies

Every relation's non-trivial FDs are listed in [Phase 1 §6](backend/docs/PHASE1_DATABASE_DESIGN.md#6-functional-dependencies). Representative examples:

| Relation | FDs |
|---|---|
| `medicine_batches` | `id → *`; `(manufacturer_id, medicine_id, batch_number) → *` (both keys) |
| `inventory` | `id → *`; `(facility_id, batch_id) → qty_available, qty_reserved, qty_damaged, updated_at` |
| `medicine_ingredients` | `(medicine_id, substance_id) → strength_value, strength_uom` |
| `movement_types` | `code → effect_available, effect_reserved, effect_damaged, requires_transfer_item, requires_reason` |
| `inventory_movements` | `id → *`. The deltas are **not** stored; they follow from `movement_type → effect_*`, which lives once in `movement_types`. |

FDs found during design and designed out ([§6.1](backend/docs/PHASE1_DATABASE_DESIGN.md#61-fds-that-were-found-and-designed-out)):
* `batch_id → medicine_id`: a medicine id in `inventory` would be transitive, so it is not stored there.
* `medicine_id → strength`: strength depends on the ingredients, so it is derived from them.
* `facility_id → organization_id`: no transfer stores organisation ids.
* `movement_type → effect`: the signs are not repeated per movement.

## 6. Normalisation (1NF → BCNF)

[Phase 1 §7](backend/docs/PHASE1_DATABASE_DESIGN.md#7-normalization-analysis) walks an un-normalised stock sheet through each normal form:

* **1NF**: repeating groups (several batches per row, comma-separated ingredients) become rows in `inventory` and `medicine_ingredients`.
* **2NF**: partial dependencies on a composite key (e.g. medicine name on `(facility, batch)`) move to `medicines` and `medicine_batches`.
* **3NF**: transitive dependencies (`batch → medicine → category`, `facility → organisation`) are removed.
* **BCNF**: every determinant is a candidate key. Tables with two candidate keys (`medicine_batches`, `inventory`) still satisfy BCNF because each determinant is one of the keys.

Controlled exceptions, documented rather than hidden ([§12.3](backend/docs/PHASE1_DATABASE_DESIGN.md#123-deliberate-compromises-documented-not-hidden)):
* `inventory` balances are derivable from the ledger. They are stored because every read needs them; a trigger maintains them, and a reconciliation function and query Q16 prove they agree.
* Alerts snapshot the stock and threshold at detection time for history.

## 7. Integrity constraints

| Kind | Examples |
|---|---|
| Domain / CHECK | `qty_* >= 0` (named `ck_inventory_*_nonneg`), `expiry_date > manufacture_date`, `min_stock_level <= reorder_threshold`, `received + damaged = quantity`, `source <> destination`, code formats (`^FAC-[0-9]{3,}$`), strength units from a fixed set |
| Entity / UNIQUE | Natural keys above; `NULLS NOT DISTINCT` on `user_roles`; partial unique indexes such as *one open shortage alert per (facility, medicine)* and *one OPEN recommendation per (source row, destination)* |
| Referential | Every FK is `ON DELETE RESTRICT` except pure compositions (`medicine_ingredients`, `role_permissions`, transfer and request lines), so history never disappears through a cascade |
| Exclusion | `ex_agreement_no_overlap`: no two overlapping validity periods for the same organisation pair (GiST over `daterange`) |
| Cross-row (deferred constraint triggers) | Every medicine has at least one ingredient; no duplicate dosage form + composition; no cycles in the region and category trees; roles granted only at their allowed level |
| State | Transfer state machine (legal transitions only; route, requester and creation time immutable); append-only event tables |

The 17 constraints the API maps to error codes are named explicitly; [Phase 2 §2 "Error convention"](backend/docs/PHASE2_IMPLEMENTATION.md#error-convention) lists the SQLSTATE → HTTP mapping.

## 8. Indexing and query optimisation

**Index inventory (≈ 100):** B-tree on every foreign key used in joins, plus:
* **Composite**: `(medicine_id, expiry_date)` for FEFO; `(status, created_at DESC)` for transfer queues; `(inventory_id, created_at DESC)` for stock history.
* **Partial**: `(facility_id) INCLUDE (batch_id, qty_available) WHERE qty_available > 0` for "in stock"; `WHERE status = 'ACTIVE'`; `WHERE read_at IS NULL`.
* **Covering**: `(movement_type, created_at) INCLUDE (inventory_id, quantity)` for consumption analytics.
* **GIN trigram** on medicine, substance and manufacturer names for `ILIKE '%…%'` search.
* **BRIN** on `created_at` / `occurred_at` of the append-only ledger and audit log, whose physical order follows time.

The full list and rationale are in [Phase 1 §11.4](backend/docs/PHASE1_DATABASE_DESIGN.md#114-indexes-in-migrations001_schemasql).

### EXPLAIN ANALYZE examples

**Stock history of one inventory row** (seeded database): the composite index serves the lookup, and the uncorrelated subquery runs once as an InitPlan.

```
Limit  (actual time=3.567..3.570 rows=10 loops=1)
  InitPlan 1 (returns $0)
    ->  …  HashAggregate over inventory_movements (rows=1839)
  ->  Sort  Sort Key: mv.created_at DESC  Sort Method: quicksort
        ->  Bitmap Heap Scan on inventory_movements mv  (rows=17)
              ->  Bitmap Index Scan on ix_movements_inventory_time
                    Index Cond: (inventory_id = $0)
Execution Time: 3.998 ms
```

**Pending transfers, same query at two scales.** This shows that the planner, not the index's existence, decides. With 43 transfers (seed) a sequential scan is cheapest:

```
Seq Scan on transfer_requests t  (actual rows=3)  Filter: (status = 'PENDING')  Rows Removed by Filter: 40
Execution Time: 0.055 ms
```

With 100,042 transfers (perf database) the composite index is chosen:

```
Bitmap Index Scan on ix_transfers_status_created  (actual rows=1042)
Sort Method: top-N heapsort  Memory: 42kB
Execution Time: 4.1 ms
```

### Before/after study (Phase 5)

The four target queries were measured on a scaled synthetic database (2.0 M movements, 224 k inventory rows, 100 k transfers, 9 k medicines, 300 facilities). Each candidate was created inside a transaction, measured and rolled back. Full plans: [`backend/docs/perf/EXPLAIN_RESULTS.md`](backend/docs/perf/EXPLAIN_RESULTS.md); analysis: [`PHASE5_TESTING_AND_OPTIMISATION.md`](backend/docs/PHASE5_TESTING_AND_OPTIMISATION.md).

| Query | Before | After | What changed |
|---|---|---|---|
| Medicine search, full endpoint | 7.9 s | 0.37 s | Migration 009 (see below); a trigram index on `code` was measured and rejected |
| FEFO sourcing | 589 ms | 43 ms | Migration 009 + authorisation and distance computed once per partner facility (`MATERIALIZED` CTE) |
| Monthly consumption | 2.1 s refresh / 89 ms read | unchanged | Served by the covering index and the materialized view; extra MV index saves ~30 ms, not adopted |
| Pending transfers | 4 ms | unchanged | Already served by `ix_transfers_status_created` |

**Lesson:** none of the slow queries needed an index. The costs were a **VOLATILE** function, which prevented CTE inlining and was evaluated about 1.3 M times, a **correlated subquery** run 9,050 times, and **per-row function calls** that depended only on the facility. Migration `009_query_performance.sql` fixes the first two without changing any result; the study proves this by fingerprinting every row of the affected views before and after.

## 9. Views and materialized views

| View | Purpose | Technique |
|---|---|---|
| `v_region_tree`, `v_category_tree` | Paths and depth of the hierarchies | Recursive CTE |
| `v_medicine_catalogue` | Medicine + unit + category path + substances | Joins, `string_agg` |
| `v_inventory_detail` | Inventory row + batch + expiry bucket + usability + value | Joins, CASE on dates (today computed once, migration 009) |
| `v_facility_stock` | Usable / reserved / damaged / expired per (facility, medicine) | `FILTER` aggregates |
| `v_demand` | Measured vs estimated daily demand, censoring flag | `LATERAL` aggregate over the ledger |
| `v_shortage_status`, `v_critical_shortages` | Days of cover and CRITICAL / LOW / OK per stock policy | Views over views |
| `v_expiring_inventory`, `v_facility_inventory_summary`, `v_medicine_availability` | Monitoring and network totals | Aggregates, grouped joins |
| `v_pending_transfers` | Approval queue with missing stages | Array of stages minus `NOT EXISTS` approvals |
| `v_transfer_timeline` | Lifecycle with previous status and time in each state | `LAG`, `LEAD`, `ROW_NUMBER` |
| `v_org_inventory_analytics` | Organisation-level KPIs | Aggregates |
| `mv_monthly_consumption` | Units dispensed per month, facility and medicine | Materialized; unique index allows `REFRESH … CONCURRENTLY` |

## 10. Stored procedures and functions

All stock and transfer writes are `SECURITY DEFINER` routines that **re-check the caller's permission inside the database** and accept an optional idempotency key. Full table: [Phase 2 §2](backend/docs/PHASE2_IMPLEMENTATION.md#2-routines).

| Routine | Role |
|---|---|
| `fn_create_transfer_request` | Validates the route, partner agreement, distance, cold chain and batch eligibility; creates a PENDING transfer (no reservation) |
| `sp_approve_transfer` → `sp_reserve_transfer_inventory` | Per-stage approval; on the last stage, locks source rows in id order and reserves all lines or none |
| `sp_reject_transfer`, `sp_cancel_transfer` | Reject (PENDING only); cancel (releases reservations of an APPROVED transfer) |
| `sp_dispatch_transfer`, `sp_receive_transfer` | TRANSFER_OUT; TRANSFER_IN + TRANSIT_DAMAGE, race-safe destination row, closes fulfilled stock requests |
| `sp_receive_stock` | Goods receipt; creates the lot on first sight |
| `fn_stock_action` (migration 008) → `fn_record_dispense` / `fn_record_damage` / `fn_dispose_damaged` / `fn_write_off_expired` / `fn_adjust_stock` | Exactly-once single-row ledger actions |
| `fn_generate_recommendations` | Redistribution engine (shortage cover FEFO-first by distance, then near-expiry surplus), run in one REPEATABLE READ snapshot, advisory only |
| `fn_reconcile_inventory` | Lists every discrepancy (balance vs ledger, reserved vs open transfer lines, received vs TRANSFER_IN) |
| `fn_generate_expiry_alerts`, `fn_refresh_shortage_alerts`, `fn_refresh_analytics` | Scheduled jobs |
| `fn_user_has_permission`, `fn_user_facility_ids`, `fn_is_transfer_authorised`, `fn_distance_km`, `fn_idem_lookup` / `fn_idem_record`, `fn_now` / `fn_today` | Building blocks |

## 11. Triggers

| Trigger | Purpose |
|---|---|
| `trg_inventory_movements_apply` | **The only write path to balances**: applies `quantity × effect_*` from `movement_types`; enforces reason and transfer-item requirements |
| `trg_inventory_guard` | Inventory rows can't be inserted non-zero, updated outside the ledger trigger, or deleted, even by a superuser |
| `trg_*_append_only` / `_no_truncate` | Ledger, audit log, status history and approvals are immutable |
| `trg_transfer_state_validate`, `trg_transfer_history` | State machine; history row with the acting user for every transition |
| `trg_inventory_threshold`, `trg_settings_threshold`, `trg_batch_status_threshold` | Open, escalate, de-escalate and resolve shortage alerts as stock or policy changes |
| `trg_audit_inventory_change`, `trg_audit_batch_status` | Audit losses, corrections, large movements and recalls |
| Deferred constraint triggers | Medicine composition rules; hierarchy cycle checks; role-grant level |

Time-driven work (expiry, recommendations) is deliberately **not** a trigger, because nothing changes in the data when a date passes. It runs as scheduled jobs ([Phase 1 §11.2](backend/docs/PHASE1_DATABASE_DESIGN.md#112-triggers-phase-2-and-where-theyre-deliberately-not-used)).

## 12. Transactions, concurrency and isolation

**Isolation level.** Writes run at READ COMMITTED with **explicit row locks**, which is the right tool for "check stock, then reserve". Analytics and the redistribution engine run at **REPEATABLE READ**, so every figure comes from one snapshot. SERIALIZABLE is demonstrated in the concurrency suite, where a stale-snapshot writer is aborted with `40001` and retried.

**Atomic reservation (the 150-unit example).** Facility A has 150 available units. Transfers to B and C, each for 100, are approved at the same moment.

1. Both approvals call `sp_reserve_transfer_inventory`, which runs `SELECT … FROM inventory … FOR UPDATE` on A's row.
2. Approval 1 locks the row, sees 150 ≥ 100, writes a RESERVE movement (the trigger moves 100 from available to reserved) and commits.
3. Approval 2 was **blocked** on the row lock. It now re-reads the committed row: 50 available, which is less than 100. It raises `INSUFFICIENT_STOCK` and rolls back entirely: no approval row is written, and the transfer stays PENDING.
4. Final state: 50 available, 100 reserved, never more than 150 committed. `ck_inventory_available_nonneg` is a last line of defence.

The concurrency suite runs this with real parallel connections, including 20 simultaneous approvals of 10 units against 100, where exactly 10 succeed ([Phase 2 §6](backend/docs/PHASE2_IMPLEMENTATION.md#6-test-results-npm-run-dbtest)).

| Hazard | Prevention |
|---|---|
| Lost update / double allocation | `FOR UPDATE` on inventory rows; balances changed only by the ledger trigger |
| Negative stock | Lock + re-check, then CHECK constraints |
| Expired or recalled stock allocated | Eligibility re-checked under lock at approval **and** at dispatch |
| Deadlocks between multi-line transfers | Rows locked in ascending id order; the API retries `40P01` / `40001` (`withRetry`) |
| Duplicate request on retry | `idempotency_keys (user_id, idem_key)` recorded in the same transaction; same key + different body → 422 |
| Partial multi-step operation | Each routine is one transaction: all lines reserve, or none do |

ACID mapping and the full hazard list: [Phase 1 §9](backend/docs/PHASE1_DATABASE_DESIGN.md#9-transaction--concurrency-design).

## 13. SQL query catalogue

Twenty-four queries, each answering a real operational question. They live in [`backend/db/queries/dbms_queries.sql`](backend/db/queries/dbms_queries.sql), and `npm run db:queries` runs all of them **read-only as the least-privilege `medshare_app` role** against the seeded database (all 24 run; Q16 and Q17 return zero rows, which is the integrity proof).

| # | Technique |
|---|---|
| Q01 | Multi-table inner joins + aggregation |
| Q02, Q15 | GROUP BY … HAVING |
| Q03, Q17 | Correlated subqueries |
| Q04 | Nested subquery (NOT IN) |
| Q05 | NOT EXISTS anti-join |
| Q06 | `RANK()` and `SUM() OVER (PARTITION BY …)` |
| Q07 | `LAG()` month-over-month |
| Q08 | Running total `SUM() OVER (ORDER BY …)` |
| Q09, Q22 | `ROW_NUMBER()` / `DENSE_RANK()` top-N per group |
| Q10 | Multiple CTEs |
| Q11, Q12 | Recursive CTEs (category roll-up, region roll-up) |
| Q13, Q14 | Date analytics (`generate_series` calendar, intervals, `percentile_cont`) |
| Q16 | Aggregate + outer join reconciliation |
| Q18 | View + `unnest` |
| Q19, Q21 | Conditional aggregation with `FILTER` |
| Q20 | `GROUP BY ROLLUP` |
| Q23 | `INTERSECT` |
| Q24 | Range containment over an exclusion-constrained table |

<!-- QUERY-CATALOGUE:START -->

### Q01: Usable stock by facility and medicine with category (multi-table inner joins)

**Use:** The core "what do we hold, where" report.

```sql
SELECT f.code AS facility, m.name AS medicine, c.name AS category,
       sum(i.qty_available) AS usable_units
FROM inventory i
JOIN medicine_batches b   ON b.id = i.batch_id
JOIN medicines m          ON m.id = b.medicine_id
JOIN medicine_categories c ON c.id = m.category_id
JOIN facilities f         ON f.id = i.facility_id
WHERE b.status = 'ACTIVE' AND b.expiry_date >= fn_today()
GROUP BY f.code, m.name, c.name
ORDER BY usable_units DESC
LIMIT 10;
```

### Q02: Medicines held by fewer than 3 facilities (GROUP BY ... HAVING)

**Use:** Single-point-of-supply risk; one stock-out there leaves the network short.

```sql
SELECT m.code, m.name, count(DISTINCT i.facility_id) AS facilities_holding,
       sum(i.qty_available) AS network_units
FROM medicines m
JOIN medicine_batches b ON b.medicine_id = m.id
JOIN inventory i        ON i.batch_id = b.id AND i.qty_available > 0
WHERE b.status = 'ACTIVE' AND b.expiry_date >= fn_today()
GROUP BY m.id, m.code, m.name
HAVING count(DISTINCT i.facility_id) < 3
ORDER BY facilities_holding, network_units;
```

### Q03: Facilities holding a medicine below that medicine's network average (correlated subquery)

**Use:** Who is under-stocked relative to peers, independent of configured thresholds.

```sql
SELECT fs.facility_id, f.code, m.name, fs.usable,
       round((SELECT avg(x.usable) FROM v_facility_stock x WHERE x.medicine_id = fs.medicine_id), 1) AS network_avg
FROM v_facility_stock fs
JOIN facilities f ON f.id = fs.facility_id
JOIN medicines m  ON m.id = fs.medicine_id
WHERE m.is_essential
  AND fs.usable < 0.25 * (SELECT avg(x.usable) FROM v_facility_stock x WHERE x.medicine_id = fs.medicine_id)
ORDER BY m.name, fs.usable
LIMIT 15;
```

### Q04: Essential medicines not stocked at any primary health centre (nested subquery, NOT IN)

**Use:** Coverage gap at the level of care closest to patients.

```sql
SELECT m.code, m.name
FROM medicines m
WHERE m.is_essential
  AND m.id NOT IN (
        SELECT b.medicine_id
        FROM inventory i
        JOIN medicine_batches b ON b.id = i.batch_id
        JOIN facilities f       ON f.id = i.facility_id
        WHERE f.facility_type = 'PRIMARY_HEALTH_CENTRE' AND i.qty_available > 0
          AND b.expiry_date >= fn_today())
ORDER BY m.name;
```

### Q05: Critical shortages with no transfer already on its way (NOT EXISTS)

**Use:** The shortages that still need someone to act.

```sql
SELECT ss.facility_code, ss.medicine_name, ss.usable, ss.min_stock_level, ss.days_of_inventory
FROM v_shortage_status ss
WHERE ss.stock_status = 'CRITICAL'
  AND NOT EXISTS (
        SELECT 1
        FROM transfer_requests t
        JOIN transfer_items ti  ON ti.transfer_id = t.id
        JOIN medicine_batches b ON b.id = ti.batch_id
        WHERE t.destination_facility_id = ss.facility_id AND b.medicine_id = ss.medicine_id
          AND t.status IN ('PENDING', 'APPROVED', 'DISPATCHED'))
ORDER BY ss.days_of_inventory NULLS FIRST, ss.facility_code
LIMIT 15;
```

### Q06: Rank facilities by usable stock value within their organisation (RANK, SUM OVER PARTITION)

**Use:** Where an organisation's money is sitting; share of the organisation total.

```sql
SELECT o.name AS organisation, f.code, f.name,
       round(sum(d.available_value), 2) AS usable_value,
       RANK() OVER (PARTITION BY o.id ORDER BY sum(d.available_value) DESC) AS rank_in_org,
       round(100 * sum(d.available_value) / sum(sum(d.available_value)) OVER (PARTITION BY o.id), 1) AS pct_of_org
FROM v_inventory_detail d
JOIN facilities f    ON f.id = d.facility_id
JOIN organizations o ON o.id = f.organization_id
WHERE d.is_usable
GROUP BY o.id, o.name, f.code, f.name
ORDER BY o.name, rank_in_org;
```

### Q07: Month-over-month dispensing change per facility (LAG)

**Use:** Spotting demand jumps that thresholds have not caught up with.

```sql
WITH monthly AS (
    SELECT i.facility_id, date_trunc('month', mv.created_at)::date AS month, sum(mv.quantity) AS units
    FROM inventory_movements mv
    JOIN inventory i ON i.id = mv.inventory_id
    WHERE mv.movement_type = 'DISPENSE'
    GROUP BY 1, 2
)
SELECT f.code, to_char(month, 'YYYY-MM') AS month, units,
       units - LAG(units) OVER w AS change,
       round(100.0 * (units - LAG(units) OVER w) / nullif(LAG(units) OVER w, 0), 1) AS change_pct
FROM monthly JOIN facilities f ON f.id = monthly.facility_id
WINDOW w AS (PARTITION BY facility_id ORDER BY month)
ORDER BY f.code, month;
```

### Q08: Running balance of one inventory row rebuilt from the ledger (SUM OVER ORDER BY)

**Use:** Audit — the current balance must equal the running total of signed deltas.

```sql
WITH target AS (SELECT inventory_id FROM inventory_movements GROUP BY inventory_id ORDER BY count(*) DESC LIMIT 1)
SELECT mv.id, mv.created_at, mv.movement_type, mv.quantity * mt.effect_available AS delta_available,
       SUM(mv.quantity * mt.effect_available) OVER (ORDER BY mv.created_at, mv.id) AS running_available
FROM inventory_movements mv
JOIN movement_types mt ON mt.code = mv.movement_type
WHERE mv.inventory_id = (SELECT inventory_id FROM target)
ORDER BY mv.created_at, mv.id;
```

### Q09: First-expiry-first-out pick: the batch to issue next per facility and medicine (ROW_NUMBER)

**Use:** FEFO, the rule the reservation procedures apply, shown as a query.

```sql
SELECT facility_code, medicine_name, batch_number, expiry_date, qty_available
FROM (
    SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.facility_id, d.medicine_id ORDER BY d.expiry_date, d.batch_id) AS fefo_rank
    FROM v_inventory_detail d
    WHERE d.is_usable AND d.qty_available > 0
) ranked
WHERE fefo_rank = 1 AND facility_code = 'FAC-001'
ORDER BY medicine_name;
```

### Q10: Shortages paired with same-organisation surplus within dispatch radius (multiple CTEs)

**Use:** A transparent, simplified version of the redistribution engine's matching step.

```sql
WITH need AS (
    SELECT facility_id, medicine_id, reorder_threshold - usable AS deficit
    FROM v_shortage_status WHERE stock_status <> 'OK'
), surplus AS (
    SELECT s.facility_id, s.medicine_id, s.usable - s.reorder_threshold - s.safety_stock AS spare
    FROM v_shortage_status s
    WHERE s.usable > s.reorder_threshold + s.safety_stock
)
SELECT m.name AS medicine, fd.code AS short_facility, n.deficit,
       fs.code AS surplus_facility, s.spare, fn_distance_km(fs.id, fd.id) AS km
FROM need n
JOIN surplus s     ON s.medicine_id = n.medicine_id AND s.facility_id <> n.facility_id
JOIN facilities fd ON fd.id = n.facility_id
JOIN facilities fs ON fs.id = s.facility_id AND fs.organization_id = fd.organization_id
JOIN medicines m   ON m.id = n.medicine_id
WHERE fn_distance_km(fs.id, fd.id) <= fs.max_dispatch_radius_km
ORDER BY n.deficit DESC, km
LIMIT 15;
```

### Q11: Category tree with medicine counts rolled up to every ancestor (recursive CTE)

**Use:** Catalogue navigation; "Anti-infectives" includes its sub-categories.

```sql
WITH RECURSIVE tree AS (
    SELECT id, parent_id, name, 1 AS depth, name::text AS path FROM medicine_categories WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.parent_id, c.name, t.depth + 1, t.path || ' › ' || c.name
    FROM medicine_categories c JOIN tree t ON c.parent_id = t.id
), ancestry AS (
    SELECT id AS ancestor_id, id AS descendant_id FROM medicine_categories
    UNION ALL
    SELECT a.ancestor_id, c.id FROM ancestry a JOIN medicine_categories c ON c.parent_id = a.descendant_id
)
SELECT t.path, t.depth, count(m.id) AS medicines_incl_subcategories
FROM tree t
JOIN ancestry a     ON a.ancestor_id = t.id
LEFT JOIN medicines m ON m.category_id = a.descendant_id
GROUP BY t.path, t.depth
ORDER BY t.path;
```

### Q12: Usable units rolled up the region hierarchy, state › district › taluk (recursive CTE)

**Use:** Regional availability for planners (the analytics "availability by region").

```sql
WITH RECURSIVE up AS (
    SELECT f.id AS facility_id, r.id AS region_id, r.parent_id FROM facilities f JOIN regions r ON r.id = f.region_id
    UNION ALL
    SELECT up.facility_id, r.id, r.parent_id FROM up JOIN regions r ON r.id = up.parent_id
)
SELECT r.name AS region, count(DISTINCT up.facility_id) AS facilities, coalesce(sum(fs.usable), 0) AS usable_units
FROM up
JOIN regions r ON r.id = up.region_id
LEFT JOIN v_facility_stock fs ON fs.facility_id = up.facility_id
GROUP BY r.id, r.name
ORDER BY usable_units DESC;
```

### Q13: Expiry calendar for the next 12 months, including empty months (generate_series + LEFT JOIN)

**Use:** Plan redistribution and procurement around upcoming expiries.

```sql
SELECT to_char(m.month, 'YYYY-MM') AS month,
       count(d.inventory_id) AS inventory_rows,
       coalesce(sum(d.qty_available + d.qty_reserved), 0) AS units,
       coalesce(round(sum((d.qty_available + d.qty_reserved) * d.unit_cost), 2), 0) AS value_inr
FROM generate_series(date_trunc('month', fn_today()), date_trunc('month', fn_today()) + interval '11 months', interval '1 month') AS m(month)
LEFT JOIN v_inventory_detail d
       ON date_trunc('month', d.expiry_date) = m.month AND d.qty_available + d.qty_reserved > 0
GROUP BY m.month
ORDER BY m.month;
```

### Q14: Transfer lead time by month and route type, with median (date arithmetic, percentile_cont)

**Use:** Are cross-organisation transfers slower, and is it improving?

```sql
SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') AS month,
       CASE WHEN s.organization_id <> d.organization_id THEN 'cross-organisation' ELSE 'same organisation' END AS route,
       count(*) AS received,
       round(avg(EXTRACT(EPOCH FROM (h.changed_at - t.created_at)) / 3600)::numeric, 1) AS avg_hours,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (h.changed_at - t.created_at)) / 3600))::numeric, 1) AS median_hours
FROM transfer_requests t
JOIN transfer_status_history h ON h.transfer_id = t.id AND h.to_status = 'RECEIVED'
JOIN facilities s ON s.id = t.source_facility_id
JOIN facilities d ON d.id = t.destination_facility_id
GROUP BY 1, 2
ORDER BY 1, 2;
```

### Q15: Wastage hotspots: facilities with repeated losses in the last 90 days (GROUP BY ... HAVING, FILTER)

**Use:** Where damage, disposal and expiry write-offs keep happening.

```sql
SELECT f.code, f.name,
       count(*) AS loss_events,
       sum(mv.quantity) FILTER (WHERE mv.movement_type = 'EXPIRY_WRITE_OFF') AS expired_units,
       sum(mv.quantity) FILTER (WHERE mv.movement_type IN ('DAMAGE', 'TRANSIT_DAMAGE')) AS damaged_units,
       round(sum(mv.quantity * b.unit_cost), 2) AS value_lost_inr
FROM inventory_movements mv
JOIN inventory i        ON i.id = mv.inventory_id
JOIN medicine_batches b ON b.id = i.batch_id
JOIN facilities f       ON f.id = i.facility_id
WHERE mv.movement_type IN ('EXPIRY_WRITE_OFF', 'DAMAGE', 'TRANSIT_DAMAGE', 'DISPOSAL')
  AND mv.created_at >= fn_today() - 90
GROUP BY f.id, f.code, f.name
HAVING count(*) >= 2
ORDER BY value_lost_inr DESC;
```

### Q16: Ledger reconciliation: balances that disagree with the movement ledger (aggregate + join)

**Use:** The integrity proof. Zero rows = every balance equals the sum of its signed deltas.

```sql
SELECT i.id AS inventory_id, i.qty_available, i.qty_reserved, i.qty_damaged,
       l.available AS ledger_available, l.reserved AS ledger_reserved, l.damaged AS ledger_damaged
FROM inventory i
LEFT JOIN (
    SELECT mv.inventory_id,
           sum(mv.quantity * mt.effect_available) AS available,
           sum(mv.quantity * mt.effect_reserved)  AS reserved,
           sum(mv.quantity * mt.effect_damaged)   AS damaged
    FROM inventory_movements mv JOIN movement_types mt ON mt.code = mv.movement_type
    GROUP BY mv.inventory_id
) l ON l.inventory_id = i.id
WHERE (i.qty_available, i.qty_reserved, i.qty_damaged)
      IS DISTINCT FROM (coalesce(l.available, 0), coalesce(l.reserved, 0), coalesce(l.damaged, 0));
```

### Q17: Reserved stock that no approved transfer accounts for (correlated subquery)

**Use:** The reservation invariant. Zero rows = qty_reserved equals open approved transfer lines.

```sql
SELECT i.id AS inventory_id, i.facility_id, i.qty_reserved,
       (SELECT coalesce(sum(ti.quantity), 0)
        FROM transfer_items ti JOIN transfer_requests t ON t.id = ti.transfer_id
        WHERE t.status = 'APPROVED' AND t.source_facility_id = i.facility_id AND ti.batch_id = i.batch_id) AS approved_lines
FROM inventory i
WHERE i.qty_reserved <> (SELECT coalesce(sum(ti.quantity), 0)
                         FROM transfer_items ti JOIN transfer_requests t ON t.id = ti.transfer_id
                         WHERE t.status = 'APPROVED' AND t.source_facility_id = i.facility_id AND ti.batch_id = i.batch_id);
```

### Q18: Approval workload: pending transfers by missing stage and age (view + unnest)

**Use:** Who is the bottleneck: facility managers or organisation administrators?

```sql
SELECT stage, count(*) AS waiting, round(avg(EXTRACT(EPOCH FROM age) / 3600)::numeric, 1) AS avg_age_hours,
       max(age) AS oldest
FROM v_pending_transfers p, unnest(p.missing_stages) AS stage
WHERE p.status = 'PENDING'
GROUP BY stage
ORDER BY waiting DESC;
```

### Q19: Stock-request fulfilment progress (aggregate with FILTER over fulfilment links)

**Use:** How much of each open request has arrived or is on its way.

```sql
SELECT sr.code, f.code AS facility, sr.priority, m.name AS medicine, sri.quantity_requested,
       coalesce(sum(coalesce(ti.quantity_received, 0)) FILTER (WHERE t.status = 'RECEIVED'), 0) AS received,
       coalesce(sum(ti.quantity) FILTER (WHERE t.status IN ('PENDING', 'APPROVED', 'DISPATCHED')), 0) AS in_progress
FROM stock_requests sr
JOIN facilities f            ON f.id = sr.requesting_facility_id
JOIN stock_request_items sri ON sri.stock_request_id = sr.id
JOIN medicines m             ON m.id = sri.medicine_id
LEFT JOIN stock_request_fulfilments sf ON sf.stock_request_item_id = sri.id
LEFT JOIN transfer_items ti            ON ti.id = sf.transfer_item_id
LEFT JOIN transfer_requests t          ON t.id = ti.transfer_id
WHERE sr.status = 'OPEN'
GROUP BY sr.id, sr.code, f.code, sr.priority, m.name, sri.id, sri.quantity_requested
ORDER BY sr.priority DESC, sr.code;
```

### Q20: Audit activity by action and day with subtotals (GROUP BY ROLLUP)

**Use:** What changed recently, with per-day and grand totals for the auditor.

```sql
SELECT coalesce(to_char(occurred_at::date, 'YYYY-MM-DD'), 'all days') AS day,
       coalesce(action, '(all actions)') AS action,
       count(*) AS entries
FROM audit_logs
WHERE occurred_at >= fn_today() - 7
GROUP BY ROLLUP (occurred_at::date, action)
ORDER BY occurred_at::date NULLS LAST, action NULLS LAST;
```

### Q21: Days-of-cover distribution per organisation (CASE bucketing + conditional aggregation)

**Use:** How many medicine–facility pairs have < 7, 7–30, 30–90 or 90+ days of stock.

```sql
SELECT o.name AS organisation,
       count(*) FILTER (WHERE ss.days_of_inventory < 7)                AS under_7_days,
       count(*) FILTER (WHERE ss.days_of_inventory >= 7 AND ss.days_of_inventory < 30)  AS d7_to_30,
       count(*) FILTER (WHERE ss.days_of_inventory >= 30 AND ss.days_of_inventory < 90) AS d30_to_90,
       count(*) FILTER (WHERE ss.days_of_inventory >= 90)              AS over_90_days,
       count(*) FILTER (WHERE ss.days_of_inventory IS NULL)            AS no_demand_estimate
FROM v_shortage_status ss
JOIN organizations o ON o.id = ss.organization_id
GROUP BY o.name
ORDER BY o.name;
```

### Q22: Top 3 most-dispensed medicines per facility in the last 30 days (top-N per group with DENSE_RANK)

**Use:** Each facility's fast movers, to prioritise their stock policies.

```sql
SELECT facility, medicine, units
FROM (
    SELECT f.code AS facility, m.name AS medicine, sum(mv.quantity) AS units,
           DENSE_RANK() OVER (PARTITION BY f.id ORDER BY sum(mv.quantity) DESC) AS rnk
    FROM inventory_movements mv
    JOIN inventory i        ON i.id = mv.inventory_id
    JOIN medicine_batches b ON b.id = i.batch_id
    JOIN medicines m        ON m.id = b.medicine_id
    JOIN facilities f       ON f.id = i.facility_id
    WHERE mv.movement_type = 'DISPENSE' AND mv.created_at >= fn_today() - 30
    GROUP BY f.id, f.code, m.id, m.name
) t
WHERE rnk <= 3
ORDER BY facility, units DESC;
```

### Q23: Medicines short somewhere AND near expiry elsewhere (INTERSECT)

**Use:** The redistribution sweet spot. Moving that stock fixes a shortage and saves stock from expiring.

```sql
SELECT m.name FROM medicines m WHERE m.id IN (
    SELECT medicine_id FROM v_shortage_status WHERE stock_status <> 'OK'
    INTERSECT
    SELECT medicine_id FROM v_inventory_detail
    WHERE is_usable AND qty_available > 0 AND expiry_date <= fn_today() + 60)
ORDER BY m.name;
```

### Q24: Organisations that may exchange stock today (self-join over an exclusion-constrained period table)

**Use:** Which cross-organisation routes are open; transfers between other pairs are refused.

```sql
SELECT a.name AS organisation_a, b.name AS organisation_b, g.valid_from, coalesce(g.valid_to::text, 'open-ended') AS valid_to
FROM organization_agreements g
JOIN organizations a ON a.id = g.organization_a_id
JOIN organizations b ON b.id = g.organization_b_id
WHERE daterange(g.valid_from, g.valid_to, '[)') @> fn_today()
ORDER BY a.name, b.name;
```

<!-- QUERY-CATALOGUE:END -->

## 14. Security, auditing, testing and limitations

**Least privilege.**
* `medshare_owner` owns every object and runs migrations.
* `medshare_app` (the API) can read, write master data, and `EXECUTE` the routines above, but has **no** INSERT/UPDATE/DELETE on inventory, the ledger, transfers, batches or idempotency keys, and can only INSERT into the audit log.
* `medshare_readonly` sees views only.
* Passwords are bcrypt hashes (CHECK-enforced format); the API uses short-lived HS256 JWTs; every `facilityId` filter is checked against the user's scope (403, never silently widened).

**Auditing.** `audit_logs` is append-only (trigger and privilege) and records the actor, facility, before/after JSON, request id and IP, for logins, stock changes, transfer transitions, policy changes, role grants and recalls. Event times come from `fn_now()`, which the app role cannot back-date.

**Testing.**

| Suite | Count | What it proves |
|---|---|---|
| SQL integrity (`db/tests/001_integrity.sql`, rolled back) | 77 | Ledger, lifecycle, contention, authorisation, rules, idempotency, alerts, engine, reconciliation |
| Concurrency (`scripts/concurrency.ts`, real parallel connections) | 22 | Row-lock blocking, exactly-N winners, single dispatch, idempotent races, deadlock retry, SERIALIZABLE abort, privileges |
| API integration (Vitest + Supertest, real PostgreSQL) | 55 | Auth, authorisation and scope, catalogue, stock operations, idempotent retries, transfer workflow incl. concurrent approvals, monitoring, analytics |
| Query catalogue (`npm run db:queries`) | 24 | Every documented query runs read-only as the app role |
| Performance study (`npm run perf:explain`) | 9 measurements | Before/after plans; result equivalence of migration 009 |

**Limitations.**
* Distance is straight-line (haversine), not road distance.
* Demand is a 30-day average with a censoring fallback, not a forecast.
* The engine is greedy, not an optimiser.
* `/medicines` still aggregates network stock for every medicine before paginating (~0.37 s at 9 k medicines); a precomputed summary would trade freshness for speed.
* The perf dataset bypasses ledger triggers, so it is suitable for plans, not for reconciliation.
* MedShare is a simulation and is not validated for clinical or regulatory use.
