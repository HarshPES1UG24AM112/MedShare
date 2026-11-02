-- Scales a freshly migrated + seeded database up to a realistic load for EXPLAIN.
--
-- Run ONLY against the disposable medshare_perf database (scripts/perf.ts does
-- that). It bulk-loads synthetic rows as superuser with
-- session_replication_role = replica, so row triggers (ledger application,
-- audit, alert refresh) and FK triggers do NOT fire. CHECK, UNIQUE and NOT NULL
-- constraints still apply. Inventory balances are therefore set directly and do
-- not reconcile with the bulk DISPENSE history; that is acceptable for plan
-- analysis, and nothing here touches the real medshare database.
--
-- Target volumes: 300 facilities, ~9,000 medicines, ~36,000 batches,
-- ~220,000 inventory rows, 2,000,000 movements, 100,000 transfers.

SET session_replication_role = replica;
SELECT setseed(0.42);

-- Facilities: FAC-016 .. FAC-300 around Bengaluru, spread over the leaf regions and 5 organisations.
INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude,
                        has_cold_chain, max_dispatch_radius_km, contact_phone, is_synthetic)
SELECT 1 + (g % 5),
       (SELECT id FROM regions r WHERE NOT EXISTS (SELECT 1 FROM regions c WHERE c.parent_id = r.id) ORDER BY id OFFSET (g % 11) LIMIT 1),
       'FAC-' || lpad(g::text, 3, '0'),
       'Perf Facility ' || g,
       (ARRAY['HOSPITAL','COMMUNITY_HEALTH_CENTRE','PRIMARY_HEALTH_CENTRE','PHARMACY','WAREHOUSE']::facility_type[])[1 + g % 5],
       g || ' Synthetic Road',
       12.5 + random() * 1.2, 77.0 + random() * 1.2,
       g % 3 <> 0, 150, '+91 80 3000 ' || lpad(g::text, 4, '0'), true
FROM generate_series(16, 300) g;

-- Substances and medicines (MED-0051 .. MED-9050) with pseudo-word names for realistic trigram search.
INSERT INTO substances (name)
SELECT initcap(translate(substr(md5('s' || g), 1, 10), '0123456789', 'aeioubcdlm')) || 'ine'
FROM generate_series(1, 3000) g
ON CONFLICT (name) DO NOTHING;

INSERT INTO medicines (code, name, dosage_form, category_id, dispensing_unit_id, requires_cold_chain, is_essential, description)
SELECT 'MED-' || lpad((50 + g)::text, 4, '0'),
       initcap(translate(substr(md5('m' || g), 1, 9), '0123456789', 'aeioubcdlm')) || (ARRAY['cillin','zole','pril','statin','mab','vir','dine','mycin'])[1 + g % 8],
       (ARRAY['TABLET','CAPSULE','SYRUP','INJECTION','CREAM']::dosage_form[])[1 + g % 5],
       (SELECT id FROM medicine_categories ORDER BY id OFFSET (g % 20) LIMIT 1),
       (SELECT id FROM medicine_units ORDER BY id LIMIT 1),
       g % 25 = 0, g % 4 = 0, 'Synthetic performance-test entry'
FROM generate_series(1, 9000) g;

INSERT INTO medicine_ingredients (medicine_id, substance_id, strength_value, strength_uom)
SELECT m.id, s.id, (1 + m.id % 50) * 10, 'mg'
FROM medicines m
JOIN LATERAL (SELECT id FROM substances ORDER BY id OFFSET (m.id * 7) % 3000 LIMIT 1) s ON true
WHERE m.code > 'MED-0050'
ON CONFLICT DO NOTHING;

-- Batches: 4 per new medicine; 20 extra lots for MED-0001 and MED-0034 (the FEFO sourcing targets).
INSERT INTO medicine_batches (medicine_id, manufacturer_id, batch_number, manufacture_date, expiry_date, unit_cost)
SELECT m.id, 1 + (m.id + k) % 6, 'PF' || m.id || '-' || k,
       current_date - 400 + k * 30, current_date - 30 + k * 200 + (m.id % 90), round((0.5 + random() * 20)::numeric, 2)
FROM medicines m CROSS JOIN generate_series(1, 4) k
WHERE m.code > 'MED-0050';

INSERT INTO medicine_batches (medicine_id, manufacturer_id, batch_number, manufacture_date, expiry_date, unit_cost)
SELECT m.id, 1 + k % 6, 'PFX' || m.id || '-' || k, current_date - 300, current_date + 40 + k * 25, 1.10
FROM medicines m CROSS JOIN generate_series(1, 20) k
WHERE m.code IN ('MED-0001', 'MED-0034');

-- Inventory: each new lot at 6 facilities; the 40 sourcing lots at 150 facilities each.
INSERT INTO inventory (facility_id, batch_id, qty_available, qty_reserved, qty_damaged)
SELECT DISTINCT ON (f, b.id) f, b.id, (random() * 5000)::int, 0, (random() < 0.05)::int * 3
FROM medicine_batches b
CROSS JOIN LATERAL (SELECT 1 + ((b.id * 31 + k * 47) % 300)::int AS f FROM generate_series(1, 6) k) x
WHERE b.batch_number LIKE 'PF%' AND b.batch_number NOT LIKE 'PFX%'
ON CONFLICT (facility_id, batch_id) DO NOTHING;

INSERT INTO inventory (facility_id, batch_id, qty_available, qty_reserved, qty_damaged)
SELECT f.id, b.id, 200 + (random() * 3000)::int, 0, 0
FROM medicine_batches b
JOIN facilities f ON f.id % 2 = b.id % 2 AND f.id <= 300
WHERE b.batch_number LIKE 'PFX%'
ON CONFLICT (facility_id, batch_id) DO NOTHING;

-- Stock policies for every facility × the 50 original medicines (drives shortage views).
INSERT INTO facility_medicine_settings (facility_id, medicine_id, min_stock_level, reorder_threshold, safety_stock, estimated_daily_consumption)
SELECT f.id, m.id, 100, 300, 150, round((1 + random() * 40)::numeric, 2)
FROM facilities f CROSS JOIN medicines m
WHERE f.code > 'FAC-015' AND m.code <= 'MED-0050'
ON CONFLICT DO NOTHING;

-- 2,000,000 DISPENSE movements over the last 24 months.
INSERT INTO inventory_movements (inventory_id, movement_type, quantity, reference, performed_by, created_at)
SELECT ids.a[1 + ((g::bigint * 7919) % ids.n)::int], 'DISPENSE', 1 + (random() * 120)::int, 'PERF', 1 + (g % 38),
       now() - (random() * interval '730 days')
FROM (SELECT array_agg(id ORDER BY id) AS a, count(*)::int AS n FROM inventory) ids
CROSS JOIN generate_series(1, 2000000) g;

-- 100,000 transfers (codes TRF-2023/2024/2025-NNNNN), ~1% each PENDING / APPROVED / DISPATCHED.
INSERT INTO transfer_requests (code, source_facility_id, destination_facility_id, status, requested_by, request_notes, rejection_reason, created_at, updated_at)
SELECT 'TRF-' || (2023 + g / 40000) || '-' || lpad((g % 40000 + 1)::text, 5, '0'),
       s, CASE WHEN d = s THEN 1 + s % 300 ELSE d END,
       st, 1 + g % 38, 'Perf transfer',
       CASE WHEN st = 'REJECTED' THEN 'Synthetic rejection' END,
       ts, ts + interval '2 days'
FROM generate_series(0, 99999) g
CROSS JOIN LATERAL (SELECT 1 + (g * 13) % 300 AS s, 1 + (g * 29 + 7) % 300 AS d,
                           (CASE WHEN g % 100 = 0 THEN 'PENDING' WHEN g % 100 = 1 THEN 'APPROVED' WHEN g % 100 = 2 THEN 'DISPATCHED'
                                 WHEN g % 100 < 92 THEN 'RECEIVED' WHEN g % 100 < 96 THEN 'REJECTED' ELSE 'CANCELLED' END)::transfer_status AS st,
                           now() - (random() * interval '700 days') AS ts) x;

INSERT INTO transfer_items (transfer_id, batch_id, quantity)
SELECT t.id, b.a[1 + ((t.id * 17) % b.n)::int], 10 + t.id % 200
FROM (SELECT array_agg(id ORDER BY id) AS a, count(*)::int AS n FROM medicine_batches) b
CROSS JOIN transfer_requests t WHERE t.request_notes = 'Perf transfer';

SET session_replication_role = origin;
