-- MedShare: SQL query catalogue (DBMS_DOCUMENTATION.md §13)
--
-- Each query answers a real operational question. Run them all, read-only, as the
-- least-privilege application role with:   npm run db:queries
-- Every query is delimited by a "-- Qnn:" header; the runner executes each one
-- separately and reports its row count.

-- Q01: Usable stock by facility and medicine with category (multi-table inner joins)
-- Business use: the core "what do we hold, where" report.
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

-- Q02: Medicines held by fewer than 3 facilities (GROUP BY ... HAVING)
-- Business use: single-point-of-supply risk; one stock-out there leaves the network short.
SELECT m.code, m.name, count(DISTINCT i.facility_id) AS facilities_holding,
       sum(i.qty_available) AS network_units
FROM medicines m
JOIN medicine_batches b ON b.medicine_id = m.id
JOIN inventory i        ON i.batch_id = b.id AND i.qty_available > 0
WHERE b.status = 'ACTIVE' AND b.expiry_date >= fn_today()
GROUP BY m.id, m.code, m.name
HAVING count(DISTINCT i.facility_id) < 3
ORDER BY facilities_holding, network_units;

-- Q03: Facilities holding a medicine below that medicine's network average (correlated subquery)
-- Business use: who is under-stocked relative to peers, independent of configured thresholds.
SELECT fs.facility_id, f.code, m.name, fs.usable,
       round((SELECT avg(x.usable) FROM v_facility_stock x WHERE x.medicine_id = fs.medicine_id), 1) AS network_avg
FROM v_facility_stock fs
JOIN facilities f ON f.id = fs.facility_id
JOIN medicines m  ON m.id = fs.medicine_id
WHERE m.is_essential
  AND fs.usable < 0.25 * (SELECT avg(x.usable) FROM v_facility_stock x WHERE x.medicine_id = fs.medicine_id)
ORDER BY m.name, fs.usable
LIMIT 15;

-- Q04: Essential medicines not stocked at any primary health centre (nested subquery, NOT IN)
-- Business use: coverage gap at the level of care closest to patients.
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

-- Q05: Critical shortages with no transfer already on its way (NOT EXISTS)
-- Business use: the shortages that still need someone to act.
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

-- Q06: Rank facilities by usable stock value within their organisation (RANK, SUM OVER PARTITION)
-- Business use: where an organisation's money is sitting; share of the organisation total.
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

-- Q07: Month-over-month dispensing change per facility (LAG)
-- Business use: spotting demand jumps that thresholds have not caught up with.
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

-- Q08: Running balance of one inventory row rebuilt from the ledger (SUM OVER ORDER BY)
-- Business use: audit — the current balance must equal the running total of signed deltas.
WITH target AS (SELECT inventory_id FROM inventory_movements GROUP BY inventory_id ORDER BY count(*) DESC LIMIT 1)
SELECT mv.id, mv.created_at, mv.movement_type, mv.quantity * mt.effect_available AS delta_available,
       SUM(mv.quantity * mt.effect_available) OVER (ORDER BY mv.created_at, mv.id) AS running_available
FROM inventory_movements mv
JOIN movement_types mt ON mt.code = mv.movement_type
WHERE mv.inventory_id = (SELECT inventory_id FROM target)
ORDER BY mv.created_at, mv.id;

-- Q09: First-expiry-first-out pick: the batch to issue next per facility and medicine (ROW_NUMBER)
-- Business use: FEFO, the rule the reservation procedures apply, shown as a query.
SELECT facility_code, medicine_name, batch_number, expiry_date, qty_available
FROM (
    SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.facility_id, d.medicine_id ORDER BY d.expiry_date, d.batch_id) AS fefo_rank
    FROM v_inventory_detail d
    WHERE d.is_usable AND d.qty_available > 0
) ranked
WHERE fefo_rank = 1 AND facility_code = 'FAC-001'
ORDER BY medicine_name;

-- Q10: Shortages paired with same-organisation surplus within dispatch radius (multiple CTEs)
-- Business use: a transparent, simplified version of the redistribution engine's matching step.
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

-- Q11: Category tree with medicine counts rolled up to every ancestor (recursive CTE)
-- Business use: catalogue navigation; "Anti-infectives" includes its sub-categories.
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

-- Q12: Usable units rolled up the region hierarchy, state › district › taluk (recursive CTE)
-- Business use: regional availability for planners (the analytics "availability by region").
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

-- Q13: Expiry calendar for the next 12 months, including empty months (generate_series + LEFT JOIN)
-- Business use: plan redistribution and procurement around upcoming expiries.
SELECT to_char(m.month, 'YYYY-MM') AS month,
       count(d.inventory_id) AS inventory_rows,
       coalesce(sum(d.qty_available + d.qty_reserved), 0) AS units,
       coalesce(round(sum((d.qty_available + d.qty_reserved) * d.unit_cost), 2), 0) AS value_inr
FROM generate_series(date_trunc('month', fn_today()), date_trunc('month', fn_today()) + interval '11 months', interval '1 month') AS m(month)
LEFT JOIN v_inventory_detail d
       ON date_trunc('month', d.expiry_date) = m.month AND d.qty_available + d.qty_reserved > 0
GROUP BY m.month
ORDER BY m.month;

-- Q14: Transfer lead time by month and route type, with median (date arithmetic, percentile_cont)
-- Business use: are cross-organisation transfers slower, and is it improving?
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

-- Q15: Wastage hotspots: facilities with repeated losses in the last 90 days (GROUP BY ... HAVING, FILTER)
-- Business use: where damage, disposal and expiry write-offs keep happening.
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

-- Q16: Ledger reconciliation: balances that disagree with the movement ledger (aggregate + join)
-- Business use: the integrity proof. Zero rows = every balance equals the sum of its signed deltas.
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

-- Q17: Reserved stock that no approved transfer accounts for (correlated subquery)
-- Business use: the reservation invariant. Zero rows = qty_reserved equals open approved transfer lines.
SELECT i.id AS inventory_id, i.facility_id, i.qty_reserved,
       (SELECT coalesce(sum(ti.quantity), 0)
        FROM transfer_items ti JOIN transfer_requests t ON t.id = ti.transfer_id
        WHERE t.status = 'APPROVED' AND t.source_facility_id = i.facility_id AND ti.batch_id = i.batch_id) AS approved_lines
FROM inventory i
WHERE i.qty_reserved <> (SELECT coalesce(sum(ti.quantity), 0)
                         FROM transfer_items ti JOIN transfer_requests t ON t.id = ti.transfer_id
                         WHERE t.status = 'APPROVED' AND t.source_facility_id = i.facility_id AND ti.batch_id = i.batch_id);

-- Q18: Approval workload: pending transfers by missing stage and age (view + unnest)
-- Business use: who is the bottleneck: facility managers or organisation administrators?
SELECT stage, count(*) AS waiting, round(avg(EXTRACT(EPOCH FROM age) / 3600)::numeric, 1) AS avg_age_hours,
       max(age) AS oldest
FROM v_pending_transfers p, unnest(p.missing_stages) AS stage
WHERE p.status = 'PENDING'
GROUP BY stage
ORDER BY waiting DESC;

-- Q19: Stock-request fulfilment progress (aggregate with FILTER over fulfilment links)
-- Business use: how much of each open request has arrived or is on its way.
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

-- Q20: Audit activity by action and day with subtotals (GROUP BY ROLLUP)
-- Business use: what changed recently, with per-day and grand totals for the auditor.
SELECT coalesce(to_char(occurred_at::date, 'YYYY-MM-DD'), 'all days') AS day,
       coalesce(action, '(all actions)') AS action,
       count(*) AS entries
FROM audit_logs
WHERE occurred_at >= fn_today() - 7
GROUP BY ROLLUP (occurred_at::date, action)
ORDER BY occurred_at::date NULLS LAST, action NULLS LAST;

-- Q21: Days-of-cover distribution per organisation (CASE bucketing + conditional aggregation)
-- Business use: how many medicine–facility pairs have < 7, 7–30, 30–90 or 90+ days of stock.
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

-- Q22: Top 3 most-dispensed medicines per facility in the last 30 days (top-N per group with DENSE_RANK)
-- Business use: each facility's fast movers, to prioritise their stock policies.
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

-- Q23: Medicines short somewhere AND near expiry elsewhere (INTERSECT)
-- Business use: the redistribution sweet spot. Moving that stock fixes a shortage and saves stock from expiring.
SELECT m.name FROM medicines m WHERE m.id IN (
    SELECT medicine_id FROM v_shortage_status WHERE stock_status <> 'OK'
    INTERSECT
    SELECT medicine_id FROM v_inventory_detail
    WHERE is_usable AND qty_available > 0 AND expiry_date <= fn_today() + 60)
ORDER BY m.name;

-- Q24: Organisations that may exchange stock today (self-join over an exclusion-constrained period table)
-- Business use: which cross-organisation routes are open; transfers between other pairs are refused.
SELECT a.name AS organisation_a, b.name AS organisation_b, g.valid_from, coalesce(g.valid_to::text, 'open-ended') AS valid_to
FROM organization_agreements g
JOIN organizations a ON a.id = g.organization_a_id
JOIN organizations b ON b.id = g.organization_b_id
WHERE daterange(g.valid_from, g.valid_to, '[)') @> fn_today()
ORDER BY a.name, b.name;
