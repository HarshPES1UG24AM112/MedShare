-- 009 — query performance, justified by docs/perf/EXPLAIN_RESULTS.md
--
-- Measured on the scaled synthetic dataset (2.0 M movements, 224 k inventory rows,
-- 9 k medicines, 300 facilities, 100 k transfers). No new index was justified for
-- the four target queries (see the study). The time went into two avoidable patterns:
--
-- 1. fn_today() was VOLATILE. A CTE containing a volatile call cannot be inlined,
--    so v_demand (behind v_shortage_status) computed demand for EVERY stock policy
--    before any medicine/facility filter applied: ~465 ms on each sourcing and
--    shortage lookup. "Today" is a calendar date; one value per statement is the
--    correct semantics anyway (a statement should not straddle two "todays").
--    STABLE lets the planner inline the CTE and push filters down, and lets
--    `expiry_date >= fn_today() + n` use an index. fn_now() stays VOLATILE: event
--    timestamps must be exact per row.
--
-- 2. v_inventory_detail evaluated fn_today() six times per row (days to expiry,
--    four expiry buckets, usability): ~1.3 M plpgsql calls across 224 k rows.
--    Each reference is now an uncorrelated scalar subquery, i.e. an InitPlan that
--    runs once per query.
--
-- 3. v_medicine_availability counted shortages with a correlated subquery per
--    medicine (9,050 executions). It is now one grouped join.
--
-- Output columns, names and types of both views are unchanged, so dependent
-- views and the API are unaffected.

ALTER FUNCTION fn_today() STABLE;
COMMENT ON FUNCTION fn_today() IS
    'Calendar date in Asia/Kolkata, honouring medshare.event_time for superuser seeding. STABLE: one consistent "today" per statement.';

CREATE OR REPLACE VIEW v_inventory_detail AS
SELECT i.id AS inventory_id, i.facility_id, f.code AS facility_code, f.name AS facility_name, f.organization_id,
       b.id AS batch_id, b.batch_number, b.medicine_id, m.code AS medicine_code, m.name AS medicine_name,
       mf.name AS manufacturer, b.manufacture_date, b.expiry_date, b.unit_cost, b.status AS batch_status,
       i.qty_available, i.qty_reserved, i.qty_damaged, i.updated_at,
       (b.expiry_date - (SELECT fn_today())) AS days_to_expiry,
       CASE WHEN b.expiry_date <  (SELECT fn_today())      THEN 'EXPIRED'
            WHEN b.expiry_date <= (SELECT fn_today()) + 7  THEN 'WITHIN_7_DAYS'
            WHEN b.expiry_date <= (SELECT fn_today()) + 30 THEN 'WITHIN_30_DAYS'
            WHEN b.expiry_date <= (SELECT fn_today()) + 60 THEN 'WITHIN_60_DAYS'
            ELSE 'HEALTHY' END AS expiry_bucket,
       (b.status = 'ACTIVE' AND b.expiry_date >= (SELECT fn_today())) AS is_usable,
       round(i.qty_available * b.unit_cost, 2) AS available_value
FROM inventory i
JOIN medicine_batches b ON b.id = i.batch_id
JOIN medicines m        ON m.id = b.medicine_id
JOIN manufacturers mf   ON mf.id = b.manufacturer_id
JOIN facilities f       ON f.id = i.facility_id;

CREATE OR REPLACE VIEW v_medicine_availability AS
SELECT m.id AS medicine_id, m.code, m.name, fn_strength_label(m.id) AS strength_label,
       coalesce(sum(fs.usable), 0)                         AS network_usable,
       count(*) FILTER (WHERE fs.usable > 0)               AS facilities_holding,
       min(fs.nearest_usable_expiry)                       AS nearest_expiry,
       coalesce(sh.n, 0)                                   AS facilities_short
FROM medicines m
LEFT JOIN v_facility_stock fs ON fs.medicine_id = m.id
LEFT JOIN (SELECT medicine_id, count(*) AS n FROM v_shortage_status WHERE stock_status <> 'OK' GROUP BY medicine_id) sh
       ON sh.medicine_id = m.id
GROUP BY m.id, sh.n;
