-- =============================================================================
-- 005 — views (derived data is computed, never stored)
-- =============================================================================

-- Region tree with derived level (recursive CTE): depth 1 = state, 2 = district, 3 = taluk.
CREATE VIEW v_region_tree AS
WITH RECURSIVE tree AS (
    SELECT id, parent_id, code, name, 1 AS depth, name::text AS path, id AS state_id
    FROM regions WHERE parent_id IS NULL
    UNION ALL
    SELECT r.id, r.parent_id, r.code, r.name, t.depth + 1, t.path || ' › ' || r.name, t.state_id
    FROM regions r JOIN tree t ON r.parent_id = t.id
)
SELECT id, parent_id, code, name, depth,
       (ARRAY['STATE', 'DISTRICT', 'TALUK'])[depth] AS level,
       path, state_id
FROM tree;

-- Category paths (recursive CTE).
CREATE VIEW v_category_tree AS
WITH RECURSIVE tree AS (
    SELECT id, parent_id, name, 1 AS depth, name::text AS path, id AS root_id
    FROM medicine_categories WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.parent_id, c.name, t.depth + 1, t.path || ' › ' || c.name, t.root_id
    FROM medicine_categories c JOIN tree t ON c.parent_id = t.id
)
SELECT * FROM tree;

-- Catalogue with composed strength label and category path.
CREATE VIEW v_medicine_catalogue AS
SELECT m.id, m.code, m.name, fn_strength_label(m.id) AS strength_label,
       m.name || ' ' || coalesce(fn_strength_label(m.id), '') AS display_name,
       m.dosage_form, m.unit_volume_ml, u.name AS unit, m.category_id, ct.path AS category_path, ct.name AS category,
       m.requires_cold_chain, m.is_essential, m.is_active, m.description,
       (SELECT string_agg(s.name, ', ' ORDER BY s.name)
        FROM medicine_ingredients i JOIN substances s ON s.id = i.substance_id WHERE i.medicine_id = m.id) AS substances,
       m.created_at, m.updated_at
FROM medicines m
JOIN medicine_units u   ON u.id = m.dispensing_unit_id
JOIN v_category_tree ct ON ct.id = m.category_id;

-- One row per inventory record with batch attributes and expiry bucket.
CREATE VIEW v_inventory_detail AS
SELECT i.id AS inventory_id, i.facility_id, f.code AS facility_code, f.name AS facility_name, f.organization_id,
       b.id AS batch_id, b.batch_number, b.medicine_id, m.code AS medicine_code, m.name AS medicine_name,
       mf.name AS manufacturer, b.manufacture_date, b.expiry_date, b.unit_cost, b.status AS batch_status,
       i.qty_available, i.qty_reserved, i.qty_damaged, i.updated_at,
       (b.expiry_date - fn_today()) AS days_to_expiry,
       CASE WHEN b.expiry_date <  fn_today()      THEN 'EXPIRED'
            WHEN b.expiry_date <= fn_today() + 7  THEN 'WITHIN_7_DAYS'
            WHEN b.expiry_date <= fn_today() + 30 THEN 'WITHIN_30_DAYS'
            WHEN b.expiry_date <= fn_today() + 60 THEN 'WITHIN_60_DAYS'
            ELSE 'HEALTHY' END AS expiry_bucket,
       (b.status = 'ACTIVE' AND b.expiry_date >= fn_today()) AS is_usable,
       round(i.qty_available * b.unit_cost, 2) AS available_value
FROM inventory i
JOIN medicine_batches b ON b.id = i.batch_id
JOIN medicines m        ON m.id = b.medicine_id
JOIN manufacturers mf   ON mf.id = b.manufacturer_id
JOIN facilities f       ON f.id = i.facility_id;

-- Per (facility, medicine) stock by usability.
CREATE VIEW v_facility_stock AS
SELECT facility_id, medicine_id,
       sum(qty_available) FILTER (WHERE is_usable)                           AS usable,
       sum(qty_reserved)                                                     AS reserved,
       sum(qty_damaged)                                                      AS damaged,
       sum(qty_available) FILTER (WHERE expiry_bucket = 'EXPIRED')           AS expired_on_hand,
       sum(qty_available) FILTER (WHERE batch_status <> 'ACTIVE')            AS blocked_on_hand,
       count(*) FILTER (WHERE qty_available + qty_reserved > 0)              AS batches_on_hand,
       min(expiry_date) FILTER (WHERE is_usable AND qty_available > 0)       AS nearest_usable_expiry
FROM v_inventory_detail
GROUP BY facility_id, medicine_id;

-- Demand: measured from DISPENSE history when there is enough of it, otherwise
-- the configured / simulated estimate. A facility that dispensed nothing in the
-- window (typically because it was stocked out) has censored demand — measured
-- zero is not real zero — so the estimate is used there too.
-- demand_basis makes simulated vs measured demand explicit everywhere it is shown.
CREATE VIEW v_demand AS
WITH d AS (
    SELECT s.facility_id, s.medicine_id, s.estimated_daily_consumption, s.estimate_is_simulated,
           h.first_dispense_date, coalesce(h.units_in_window, 0) AS units_in_window,
           e.measured_demand_min_history_days AS window_days,
           CASE WHEN h.first_dispense_date <= fn_today() - e.measured_demand_min_history_days
                 AND coalesce(h.units_in_window, 0) > 0
                THEN round(h.units_in_window::numeric / e.measured_demand_min_history_days, 2) END AS measured_daily_consumption,
           (h.first_dispense_date <= fn_today() - e.measured_demand_min_history_days
             AND coalesce(h.units_in_window, 0) = 0) AS possibly_censored
    FROM facility_medicine_settings s
    CROSS JOIN engine_config e
    LEFT JOIN LATERAL (
        SELECT min(mv.created_at)::date AS first_dispense_date,
               sum(mv.quantity) FILTER (WHERE mv.created_at >= fn_today() - e.measured_demand_min_history_days) AS units_in_window
        FROM inventory_movements mv
        JOIN inventory i        ON i.id = mv.inventory_id
        JOIN medicine_batches b ON b.id = i.batch_id
        WHERE mv.movement_type = 'DISPENSE' AND i.facility_id = s.facility_id AND b.medicine_id = s.medicine_id
    ) h ON true
)
SELECT facility_id, medicine_id, estimated_daily_consumption, estimate_is_simulated,
       first_dispense_date, units_in_window, window_days, measured_daily_consumption,
       coalesce(possibly_censored, false) AS possibly_censored,
       coalesce(measured_daily_consumption, estimated_daily_consumption) AS daily_rate,
       CASE WHEN measured_daily_consumption IS NOT NULL THEN 'MEASURED'
            WHEN estimate_is_simulated THEN 'ESTIMATED_SIMULATED'
            ELSE 'ESTIMATED_CONFIGURED' END AS demand_basis
FROM d;

-- Shortage status per configured (facility, medicine): days of inventory remaining.
CREATE VIEW v_shortage_status AS
SELECT s.facility_id, f.code AS facility_code, f.name AS facility_name, f.organization_id,
       s.medicine_id, m.code AS medicine_code, m.name AS medicine_name,
       coalesce(fs.usable, 0) AS usable,
       s.min_stock_level, s.reorder_threshold, s.safety_stock,
       d.daily_rate, d.demand_basis,
       CASE WHEN d.daily_rate > 0 THEN round(coalesce(fs.usable, 0) / d.daily_rate, 1) END AS days_of_inventory,
       CASE WHEN coalesce(fs.usable, 0) < s.min_stock_level   THEN 'CRITICAL'
            WHEN coalesce(fs.usable, 0) < s.reorder_threshold THEN 'LOW'
            ELSE 'OK' END AS stock_status
FROM facility_medicine_settings s
JOIN facilities f ON f.id = s.facility_id
JOIN medicines m  ON m.id = s.medicine_id
JOIN v_demand d   ON d.facility_id = s.facility_id AND d.medicine_id = s.medicine_id
LEFT JOIN v_facility_stock fs ON fs.facility_id = s.facility_id AND fs.medicine_id = s.medicine_id;

CREATE VIEW v_critical_shortages AS
SELECT * FROM v_shortage_status WHERE stock_status = 'CRITICAL';

-- Expiring inventory (stock on hand outside the healthy bucket).
CREATE VIEW v_expiring_inventory AS
SELECT * FROM v_inventory_detail
WHERE expiry_bucket <> 'HEALTHY' AND qty_available + qty_reserved > 0;

-- Facility-level summary.
CREATE VIEW v_facility_inventory_summary AS
SELECT f.id AS facility_id, f.code, f.name, f.facility_type, f.organization_id, o.name AS organization_name,
       rt.path AS region_path,
       coalesce(sum(d.qty_available) FILTER (WHERE d.is_usable), 0)            AS usable_units,
       coalesce(sum(d.qty_reserved), 0)                                        AS reserved_units,
       coalesce(sum(d.qty_damaged), 0)                                         AS damaged_units,
       coalesce(sum(d.available_value) FILTER (WHERE d.is_usable), 0)          AS usable_value,
       count(DISTINCT d.medicine_id) FILTER (WHERE d.qty_available > 0)        AS medicines_in_stock,
       count(*) FILTER (WHERE d.qty_available + d.qty_reserved > 0)            AS batches_on_hand,
       count(*) FILTER (WHERE d.expiry_bucket = 'EXPIRED' AND d.qty_available > 0) AS expired_batches,
       count(*) FILTER (WHERE d.expiry_bucket IN ('WITHIN_7_DAYS', 'WITHIN_30_DAYS') AND d.qty_available > 0) AS expiring_30d_batches,
       (SELECT count(*) FROM v_shortage_status ss WHERE ss.facility_id = f.id AND ss.stock_status = 'CRITICAL') AS critical_shortages,
       (SELECT count(*) FROM v_shortage_status ss WHERE ss.facility_id = f.id AND ss.stock_status = 'LOW')      AS low_stock
FROM facilities f
JOIN organizations o  ON o.id = f.organization_id
JOIN v_region_tree rt ON rt.id = f.region_id
LEFT JOIN v_inventory_detail d ON d.facility_id = f.id
GROUP BY f.id, o.name, rt.path;

-- Network availability per medicine (tier-2 visibility: totals, not batch detail).
CREATE VIEW v_medicine_availability AS
SELECT m.id AS medicine_id, m.code, m.name, fn_strength_label(m.id) AS strength_label,
       coalesce(sum(fs.usable), 0)                         AS network_usable,
       count(*) FILTER (WHERE fs.usable > 0)               AS facilities_holding,
       min(fs.nearest_usable_expiry)                       AS nearest_expiry,
       (SELECT count(*) FROM v_shortage_status ss WHERE ss.medicine_id = m.id AND ss.stock_status <> 'OK') AS facilities_short
FROM medicines m
LEFT JOIN v_facility_stock fs ON fs.medicine_id = m.id
GROUP BY m.id;

-- Pending work: transfers awaiting approval or dispatch, with missing stages.
CREATE VIEW v_pending_transfers AS
SELECT t.id, t.code, t.status, t.source_facility_id, s.name AS source_name, t.destination_facility_id, d.name AS destination_name,
       (s.organization_id <> d.organization_id) AS cross_organization,
       t.requested_by, u.full_name AS requested_by_name, t.created_at,
       fn_now() - t.created_at AS age,
       (SELECT count(*) FROM transfer_items ti WHERE ti.transfer_id = t.id)          AS item_count,
       (SELECT sum(ti.quantity) FROM transfer_items ti WHERE ti.transfer_id = t.id)  AS total_units,
       ARRAY(SELECT st FROM unnest(CASE WHEN s.organization_id <> d.organization_id
                                        THEN ARRAY['SOURCE_FACILITY', 'SOURCE_ORGANIZATION']::approval_stage[]
                                        ELSE ARRAY['SOURCE_FACILITY']::approval_stage[] END) st
             WHERE NOT EXISTS (SELECT 1 FROM transfer_approvals a WHERE a.transfer_id = t.id AND a.stage = st)) AS missing_stages
FROM transfer_requests t
JOIN facilities s ON s.id = t.source_facility_id
JOIN facilities d ON d.id = t.destination_facility_id
JOIN users u      ON u.id = t.requested_by
WHERE t.status IN ('PENDING', 'APPROVED');

-- Lifecycle with previous status and time in each state (window functions).
CREATE VIEW v_transfer_timeline AS
SELECT h.transfer_id, t.code, h.id AS event_id,
       LAG(h.to_status) OVER w AS from_status,
       h.to_status, h.changed_by, u.full_name AS changed_by_name, h.note, h.changed_at,
       LEAD(h.changed_at) OVER w - h.changed_at AS time_in_state,
       ROW_NUMBER() OVER w AS step
FROM transfer_status_history h
JOIN transfer_requests t ON t.id = h.transfer_id
JOIN users u ON u.id = h.changed_by
WINDOW w AS (PARTITION BY h.transfer_id ORDER BY h.changed_at, h.id);

-- Organisation-wide analytics.
CREATE VIEW v_org_inventory_analytics AS
SELECT o.id AS organization_id, o.name, o.org_type,
       count(DISTINCT f.id)                                                          AS facilities,
       coalesce(sum(fis.usable_units), 0)                                            AS usable_units,
       coalesce(sum(fis.usable_value), 0)                                            AS usable_value,
       coalesce(sum(fis.critical_shortages), 0)                                      AS critical_shortages,
       coalesce(sum(fis.expiring_30d_batches), 0)                                    AS expiring_30d_batches,
       (SELECT coalesce(sum(mv.quantity * b.unit_cost), 0)
        FROM inventory_movements mv
        JOIN inventory i ON i.id = mv.inventory_id
        JOIN facilities f2 ON f2.id = i.facility_id
        JOIN medicine_batches b ON b.id = i.batch_id
        WHERE f2.organization_id = o.id
          AND mv.movement_type IN ('EXPIRY_WRITE_OFF', 'DISPOSAL', 'DAMAGE', 'TRANSIT_DAMAGE'))  AS wastage_value_estimate,
       (SELECT round(avg((t.status = 'RECEIVED')::int), 3)
        FROM transfer_requests t JOIN facilities f3 ON f3.id = t.source_facility_id
        WHERE f3.organization_id = o.id AND t.status IN ('RECEIVED', 'REJECTED', 'CANCELLED'))  AS transfer_completion_rate
FROM organizations o
LEFT JOIN facilities f ON f.organization_id = o.id
LEFT JOIN v_facility_inventory_summary fis ON fis.facility_id = f.id
GROUP BY o.id;

-- Monthly consumption (materialized; refreshed by job, CONCURRENTLY thanks to the unique index).
CREATE MATERIALIZED VIEW mv_monthly_consumption AS
SELECT date_trunc('month', mv.created_at)::date AS month, i.facility_id, b.medicine_id,
       sum(mv.quantity) AS units_dispensed, count(*) AS dispense_events
FROM inventory_movements mv
JOIN inventory i        ON i.id = mv.inventory_id
JOIN medicine_batches b ON b.id = i.batch_id
WHERE mv.movement_type = 'DISPENSE'
GROUP BY 1, 2, 3
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_monthly_consumption ON mv_monthly_consumption (month, facility_id, medicine_id);

CREATE FUNCTION fn_refresh_analytics() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_monthly_consumption' AND ispopulated) THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_consumption;
    ELSE
        REFRESH MATERIALIZED VIEW mv_monthly_consumption;
    END IF;
END $$;
