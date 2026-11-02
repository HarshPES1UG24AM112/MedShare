# MedShare: University Demonstration Walkthrough (≈ 15 minutes)

A scripted demo that shows the product first, then proves the database guarantees behind it. Every step uses the synthetic seed; nothing needs to be prepared by hand.

## Before the session (5 minutes, once)

```bash
# Docker Desktop running; repo root has .env (copy of .env.example)
cd backend
npm run db:up
npm run db:reset          # fresh deterministic seed; ends with "reconciliation discrepancies: 0"
npm run dev               # API :4000
```

```bash
cd frontend
npm run dev               # http://localhost:5173
```

Open a second terminal with `psql` for the database part, connected as the **application role** (the API's own, least-privilege connection):

```bash
docker exec -it medshare-postgres psql -U medshare_app -d medshare
```

> If `psql` asks for a password, use `MEDSHARE_APP_PASSWORD` from `.env`.

Use two browser windows (or one normal and one private window) so two users can be signed in at once. All accounts use `MedShare@2026`, and in development builds the sign-in page offers them as one-click buttons.

---

## Part 1: The problem, as a facility sees it (3 min)

1. Sign in as **`fac-002.inventory@medshare.health`** (inventory manager, Yelahanka CHC).
2. **Dashboard**: point out the red "Action needed" banner, critical shortages, and the scope pinned to one facility. Say: *the network has the stock; this facility doesn't.*
3. **Shortages** → *Critical*. Pick a row and explain the columns:
   * *days of cover* = usable stock ÷ daily demand;
   * the **demand basis** badge: *Measured* comes from dispensing history; *Estimated (simulated)* plus *Possibly censored* means the facility dispensed nothing because it was out of stock, so measured demand would be a misleading zero.

## Part 2: Coordinating a transfer (5 min)

4. On a critical row, click **Source stock**. The request dialog opens in **pull** mode with the medicine and the deficit prefilled.
   * The **source batch** list comes from one endpoint that returns only *eligible* partner batches: FEFO order, enough remaining shelf life, active facilities within the dispatch radius, an organisation agreement for cross-organisation routes, and the cold chain respected. Pick a **FAC-001** batch (same organisation, so one approval stage).
   * **Submit**. The transfer opens as **Pending approval**. Point at *Source avail / reserved*: **nothing is reserved yet**, because a request is only a request.
5. In the second window, sign in as **`fac-001.manager@medshare.health`**. Open **Transfers → Needs my action** and open the request.
   * The buttons come from the server's `allowedActions`. The requester could not approve their own transfer, and a system administrator could not approve at all.
   * **Approve**: *Source avail / reserved* changes at once, for example from 2,910 / 0 to 1,302 / 1,608. The **reservation is atomic at approval**.
   * **Mark dispatched**: the reserved units leave the source.
6. Back in the first window: open the transfer and click **Receive stock**. Enter a few units as **damaged** (received is recalculated so the line still adds up). Confirm.
   * The **timeline** shows each `from → to` status with time spent in each state, computed with `LAG`/`LEAD` window functions in a view.
   * **Stock → history** on the received row shows the ledger: `TRANSFER_IN` to available and `TRANSIT_DAMAGE` to the damaged bucket.
   * **Shortages**: the row moved from Critical to Low (or cleared).
7. **Scope check**: as `fac-001.manager`, open `/inventory?facility=4` (another facility's stock). The server answers 403 and the page shows *Access restricted*: the filter is checked, never silently widened.

## Part 3: The network view (2 min)

8. Sign in as **`admin@medshare.health`**. **Redistribution**: prioritised recommendations, each with a plain-language explanation, distance and staleness. Accepting one only creates a *pending* transfer; the engine never moves stock by itself.
9. **Analytics**: the synthetic-data banner, regional availability rolled up the region tree (recursive CTE), recurring shortages, wastage, and transfer lead time and completion. Every chart has a table view, and all figures come from one REPEATABLE READ snapshot.
10. **Audit log**: open any entry and show the before/after values. Nothing in the app (or the app's database role) can edit or delete an entry.

## Part 4: Proving it in the database (5 min, in `psql` as `medshare_app`)

```sql
-- 1. Balances equal the ledger. Zero rows = consistent.
SELECT * FROM fn_reconcile_inventory();

-- 2. The API's own role cannot bypass the ledger …
UPDATE inventory SET qty_available = qty_available + 1000 WHERE id = 1;
--    ERROR: permission denied for table inventory

-- 3. … nor rewrite history.
DELETE FROM audit_logs WHERE id = 1;
--    ERROR: permission denied for table audit_logs

-- 4. A stock change goes through a routine that re-checks permission inside the database.
--    (actor 1 = system administrator, who has no inventory:write at any facility)
SELECT fn_stock_action(1, 1, 'dispense', 5, NULL, 'demo', NULL);
--    ERROR: User 1 lacks permission inventory:write at facility …   (HINT: FORBIDDEN)

-- 5. The transfer lifecycle, with LAG() previous status and LEAD() time in state.
SELECT step, from_status, to_status, changed_by_name, time_in_state
FROM v_transfer_timeline WHERE transfer_id = (SELECT max(id) FROM transfer_requests) ORDER BY step;

-- 6. FEFO: the next batch to issue per medicine at FAC-001 (ROW_NUMBER over expiry).
SELECT medicine_name, batch_number, expiry_date, qty_available FROM (
  SELECT d.*, ROW_NUMBER() OVER (PARTITION BY facility_id, medicine_id ORDER BY expiry_date) AS rn
  FROM v_inventory_detail d WHERE is_usable AND qty_available > 0 AND facility_code = 'FAC-001') x
WHERE rn = 1 ORDER BY medicine_name LIMIT 10;
```

Then, in a normal terminal:

```bash
cd backend
npm run db:test       # 77 SQL checks + 22 concurrency checks
```

Point at the concurrency lines while they print:
* *"session 2 blocks … then INSUFFICIENT_STOCK"*: the 150-units-two-requests scenario;
* *"20 concurrent approvals … exactly 10 succeed"*;
* *"opposite-order locks → 40P01 → retried"*;
* *"reconciliation after all races: 0 discrepancies"*.

```bash
npm run db:queries    # the 24 documented queries, read-only as medshare_app
```

## Part 5: Performance (optional, 2 min)

Open [`backend/docs/perf/EXPLAIN_RESULTS.md`](../backend/docs/perf/EXPLAIN_RESULTS.md) and its summary table. The story:
* on 2 million movements the medicine search took **7.9 s**;
* the plan showed the time was not a missing index but a VOLATILE function evaluated ~1.3 M times and a correlated subquery run 9,050 times;
* migration 009 fixed both: **0.37 s**, with the rows of the affected views proved identical before and after.

## Likely questions

| Question | Short answer (and where it is documented) |
|---|---|
| Why store balances if they're derivable from the ledger? | Every read needs them. A trigger is the only writer, and reconciliation proves equality. [DBMS §6](../DBMS_DOCUMENTATION.md#6-normalisation-1nf--bcnf) |
| Why reserve at approval, not at request? | Requests shouldn't lock stock that the source may refuse. [Phase 1 §8.3](../backend/docs/PHASE1_DATABASE_DESIGN.md#83-reservation-at-approval-not-at-request) |
| Why READ COMMITTED + `FOR UPDATE` and not SERIALIZABLE everywhere? | Row locks give a deterministic "wait, then re-check" for the hot path. SERIALIZABLE is shown in the tests, with retry. [DBMS §12](../DBMS_DOCUMENTATION.md#12-transactions-concurrency-and-isolation) |
| Is the data real? | No. Everything is synthetic and labelled; analytics responses say so in `meta.synthetic`. |
| What would production need? | Road distances, forecasting, institutional authorisation, regulatory validation, real identity management. [DBMS §14](../DBMS_DOCUMENTATION.md#14-security-auditing-testing-and-limitations) |
