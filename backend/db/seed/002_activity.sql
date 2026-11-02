-- =============================================================================
-- SEED 002 — ~6 months of SYNTHETIC activity, generated chronologically through
-- the real procedures (sp_receive_stock, fn_record_dispense, transfers…), with
-- `medshare.event_time` back-dating each step. Because nothing is inserted
-- around the ledger, balances, alerts and analytics are internally consistent.
-- =============================================================================

DO $$
DECLARE
    v_today   date := current_date;
    v_start   date := current_date - 168;          -- 12 fortnightly periods
    v_admin   bigint := (SELECT id FROM users WHERE email = 'admin@medshare.health');
    v_p       integer;
    v_t       date;
    v_prev    date;
    v_left    integer;
    v_take    integer;
    v_qty     integer;
    v_tid     bigint;
    v_req     bigint;
    v_req_item bigint;
    v_roll    double precision;
    v_status  transfer_status;
    v_inv     bigint;
    v_actor   bigint;
    v_src_fm  bigint;
    v_src_im  bigint;
    v_src_oa  bigint;
    v_dst_im  bigint;
    v_item    bigint;
    v_cnt     integer;
    v_ok      integer := 0;
    v_skipped integer := 0;
    h  record;
    r  record;
    bt record;
    n  record;
    s  record;
BEGIN
    PERFORM setseed(0.2026);

    -- Actors per facility.
    CREATE TEMP TABLE _actor ON COMMIT DROP AS
    SELECT f.id AS facility_id, f.organization_id,
           (SELECT id FROM users WHERE email = lower(f.code) || '.manager@medshare.health')   AS fm,
           (SELECT id FROM users WHERE email = lower(f.code) || '.inventory@medshare.health') AS im,
           (SELECT id FROM users WHERE email = format('org%s.admin@medshare.health', ltrim(substr(o.registration_number, 9), '0'))) AS oa
    FROM facilities f JOIN organizations o ON o.id = f.organization_id;

    CREATE TEMP TABLE _mfr ON COMMIT DROP AS
    SELECT id, (row_number() OVER (ORDER BY license_number) - 1)::integer AS ord FROM manufacturers;

    -- 150 batch plans: 3 per medicine (near-expiry/expired, mid-life, long-dated).
    CREATE TEMP TABLE _bplan ON COMMIT DROP AS
    WITH base AS (
        SELECT sp.medicine_id, k, sp.cost,
               CASE k WHEN 1 THEN v_today + (ARRAY[-15, 5, 20, 45, 90])[1 + sp.medicine_id % 5] + floor(random() * 4)::int
                      WHEN 2 THEN v_today + 120 + floor(random() * 180)::int
                      ELSE        v_today + 400 + floor(random() * 300)::int END AS expiry
        FROM _seed_params sp CROSS JOIN generate_series(1, 3) k
    )
    SELECT row_number() OVER (ORDER BY b.medicine_id, b.k) AS seq, b.medicine_id, b.k,
           (SELECT id FROM _mfr WHERE ord = (b.medicine_id + b.k) % 6) AS manufacturer_id,
           b.expiry - 730 AS mfg, b.expiry,
           round(b.cost * (0.9 + random() * 0.2)::numeric, 2) AS cost,
           greatest(CASE b.k WHEN 1 THEN v_start - 2 WHEN 2 THEN v_start + 56 ELSE v_start + 120 END, b.expiry - 730 + 15) AS receipt_day
    FROM base b;

    -- Holdings: which facility stocks which medicine, demand and scenario.
    CREATE TEMP TABLE _hold ON COMMIT DROP AS
    SELECT f.id AS facility_id, f.facility_type, sp.medicine_id,
           round((sp.daily * CASE f.facility_type WHEN 'HOSPITAL' THEN 1.6 WHEN 'COMMUNITY_HEALTH_CENTRE' THEN 1.0
                                                  WHEN 'PRIMARY_HEALTH_CENTRE' THEN 0.5 WHEN 'PHARMACY' THEN 0.7 ELSE 0.12 END
                  * (0.6 + random() * 0.8))::numeric, 2) AS daily,
           CASE WHEN f.facility_type = 'WAREHOUSE' THEN 'WAREHOUSE'
                ELSE (ARRAY['SHORT', 'EXCESS', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL'])[1 + floor(random() * 10)::int]
           END AS scenario,
           sp.daily AS ref_daily
    FROM facilities f CROSS JOIN _seed_params sp
    WHERE (NOT sp.cold OR f.has_cold_chain)
      AND NOT (f.facility_type = 'PHARMACY' AND sp.form IN ('INFUSION'))
      AND (f.facility_type = 'WAREHOUSE'
           OR random() < CASE f.facility_type WHEN 'HOSPITAL' THEN 0.95 WHEN 'COMMUNITY_HEALTH_CENTRE' THEN 0.8
                                              WHEN 'PRIMARY_HEALTH_CENTRE' THEN 0.6 ELSE 0.7 END);
    UPDATE _hold SET daily = greatest(daily, 0.3);

    -- Receipt plan per (holding, batch).
    CREATE TEMP TABLE _receipt ON COMMIT DROP AS
    SELECT hd.facility_id, b.seq, b.receipt_day + (hd.facility_id % 6) AS day,
           ceil(CASE
               WHEN hd.scenario = 'WAREHOUSE' THEN hd.ref_daily * 90 * (0.8 + random() * 0.6)
               WHEN hd.scenario = 'SHORT'  AND b.k = 1 THEN hd.daily * 60
               WHEN hd.scenario = 'SHORT'  AND b.k = 2 THEN hd.daily * 25
               WHEN hd.scenario = 'SHORT'  AND b.k = 3 THEN 0
               WHEN hd.scenario = 'EXCESS' AND b.k = 1 THEN hd.daily * 150
               ELSE hd.daily * CASE b.k WHEN 3 THEN 60 ELSE 70 END * (0.8 + random() * 0.5) END)::integer AS qty
    FROM _hold hd JOIN _bplan b ON b.medicine_id = hd.medicine_id
    WHERE b.expiry > b.receipt_day + (hd.facility_id % 6) + 10;
    DELETE FROM _receipt WHERE qty <= 0;

    -- ======================================================= timeline ========
    v_prev := NULL;
    FOR v_p IN 0..12 LOOP
        v_t := v_start + v_p * 14;

        -- Goods receipts due in this window.
        FOR r IN SELECT rc.*, b.medicine_id, b.manufacturer_id, b.mfg, b.expiry, b.cost, b.seq AS bseq, m.name
                 FROM _receipt rc JOIN _bplan b ON b.seq = rc.seq JOIN medicines m ON m.id = b.medicine_id
                 WHERE rc.day <= v_t AND (v_prev IS NULL OR rc.day > v_prev)
                 ORDER BY rc.day, rc.facility_id, rc.seq LOOP
            PERFORM set_config('medshare.event_time', (r.day + time '10:00')::timestamptz::text, true);
            SELECT im INTO v_actor FROM _actor a WHERE a.facility_id = r.facility_id;
            CALL sp_receive_stock(
                v_actor, r.facility_id, r.medicine_id, r.manufacturer_id,
                upper(left(regexp_replace(r.name, '[^A-Za-z]', '', 'g'), 3)) || to_char(r.mfg, 'YYMM') || '-' || lpad(r.bseq::text, 4, '0'),
                r.mfg, r.expiry, r.cost, r.qty, 'SYN-GRN-' || lpad((r.facility_id * 1000 + r.bseq)::text, 6, '0'), NULL, v_inv);
        END LOOP;

        -- Stock policy is configured once the first deliveries are in.
        IF v_p = 0 THEN
            PERFORM set_config('medshare.event_time', (v_t + time '09:00')::timestamptz::text, true);
            INSERT INTO facility_medicine_settings (facility_id, medicine_id, min_stock_level, reorder_threshold, safety_stock,
                                                    estimated_daily_consumption, estimate_is_simulated, updated_by)
            SELECT hd.facility_id, hd.medicine_id,
                   ceil(hd.daily * CASE WHEN hd.scenario = 'WAREHOUSE' THEN 15 ELSE 7 END),
                   greatest(1, ceil(hd.daily * CASE WHEN hd.scenario = 'WAREHOUSE' THEN 45 ELSE 21 END)),
                   ceil(hd.daily * CASE WHEN hd.scenario = 'WAREHOUSE' THEN 30 ELSE 10 END),
                   hd.daily, true, (SELECT fm FROM _actor a WHERE a.facility_id = hd.facility_id)
            FROM _hold hd;
        END IF;

        -- Occasional breakage.
        FOR h IN SELECT i.id AS inv, i.facility_id, i.qty_available FROM inventory i
                 WHERE i.qty_available > 50 AND random() < 0.015 ORDER BY i.id LOOP
            PERFORM set_config('medshare.event_time', (v_t + time '12:00')::timestamptz::text, true);
            PERFORM fn_record_damage((SELECT im FROM _actor WHERE facility_id = h.facility_id), h.inv,
                                     greatest(1, (h.qty_available * 0.02)::integer),
                                     (ARRAY['Broken in storage', 'Cold-chain excursion', 'Packaging damaged on receipt', 'Water damage in store'])[1 + floor(random() * 4)::int]);
        END LOOP;

        -- FEFO dispensing for the fortnight.
        IF v_p > 0 THEN
            PERFORM set_config('medshare.event_time', (v_t + time '18:00')::timestamptz::text, true);
            FOR h IN SELECT hd.* FROM _hold hd JOIN facilities f ON f.id = hd.facility_id
                     WHERE f.code <> 'FAC-015' OR v_t >= v_today - 21
                     ORDER BY hd.facility_id, hd.medicine_id LOOP
                v_left := round(h.daily * 14 * (0.75 + random() * 0.5));
                FOR bt IN SELECT i.id AS inv, i.qty_available
                          FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id
                          WHERE i.facility_id = h.facility_id AND b.medicine_id = h.medicine_id
                            AND b.status = 'ACTIVE' AND b.expiry_date >= v_t AND i.qty_available > 0
                          ORDER BY b.expiry_date, i.id LOOP
                    EXIT WHEN v_left <= 0;
                    v_take := least(v_left, bt.qty_available);
                    PERFORM fn_record_dispense((SELECT im FROM _actor WHERE facility_id = h.facility_id), bt.inv, v_take, 'SYN-OPD');
                    v_left := v_left - v_take;
                END LOOP;
            END LOOP;
        END IF;

        -- Transfers responding to shortages (periods 2–11 complete; later ones stay in flight).
        IF v_p BETWEEN 2 AND 11 THEN
            PERFORM set_config('medshare.event_time', (v_t + 1 + time '09:00')::timestamptz::text, true);
            FOR n IN SELECT ss.* FROM v_shortage_status ss JOIN facilities f ON f.id = ss.facility_id
                     WHERE ss.stock_status <> 'OK' AND f.facility_type <> 'WAREHOUSE'
                     ORDER BY random() LIMIT 4 LOOP
                SELECT i.id AS inv, i.facility_id AS src, b.id AS batch_id, i.qty_available
                  INTO s
                FROM inventory i
                JOIN medicine_batches b ON b.id = i.batch_id
                JOIN facilities sf ON sf.id = i.facility_id
                JOIN facilities df ON df.id = n.facility_id
                JOIN medicines m   ON m.id = b.medicine_id
                LEFT JOIN v_shortage_status src ON src.facility_id = i.facility_id AND src.medicine_id = b.medicine_id
                WHERE b.medicine_id = n.medicine_id AND i.facility_id <> n.facility_id
                  AND b.status = 'ACTIVE' AND b.expiry_date >= v_t + 30 AND i.qty_available >= 20
                  AND (src.facility_id IS NULL OR src.usable > src.reorder_threshold * 1.5)
                  AND fn_is_transfer_authorised(i.facility_id, n.facility_id)
                  AND fn_distance_km(i.facility_id, n.facility_id) <= sf.max_dispatch_radius_km
                  AND (NOT m.requires_cold_chain OR (sf.has_cold_chain AND df.has_cold_chain))
                ORDER BY (sf.organization_id = df.organization_id) DESC, b.expiry_date, fn_distance_km(i.facility_id, n.facility_id)
                LIMIT 1;
                CONTINUE WHEN NOT FOUND;
                v_qty := least(n.reorder_threshold - n.usable, floor(s.qty_available * 0.4)::integer);
                CONTINUE WHEN v_qty < 5;
                SELECT fm, im, oa INTO v_src_fm, v_src_im, v_src_oa FROM _actor a WHERE a.facility_id = s.src;
                SELECT im INTO v_dst_im FROM _actor a WHERE a.facility_id = n.facility_id;

                BEGIN
                    v_req_item := NULL;
                    IF random() < 0.5 THEN
                        v_req := fn_create_stock_request(v_dst_im, n.facility_id,
                                     jsonb_build_array(jsonb_build_object('medicine_id', n.medicine_id, 'quantity', v_qty)),
                                     CASE WHEN n.stock_status = 'CRITICAL' THEN 'URGENT' ELSE 'ROUTINE' END::request_priority,
                                     v_t + 10, 'Synthetic request: stock below reorder level');
                        SELECT id INTO v_req_item FROM stock_request_items WHERE stock_request_id = v_req;
                    END IF;

                    PERFORM set_config('medshare.event_time', (v_t + 1 + time '11:00')::timestamptz::text, true);
                    v_tid := fn_create_transfer_request(v_dst_im, s.src, n.facility_id,
                                 jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('batch_id', s.batch_id, 'quantity', v_qty,
                                                                                       'stock_request_item_id', v_req_item))),
                                 format('%s below reorder level (%s of %s)', n.medicine_name, n.usable, n.reorder_threshold));
                    v_roll := random();
                    IF v_roll < 0.08 THEN
                        PERFORM set_config('medshare.event_time', (v_t + 1 + time '16:00')::timestamptz::text, true);
                        CALL sp_reject_transfer(v_src_fm, v_tid,
                            (ARRAY['Stock committed to a scheduled outreach camp', 'Source is approaching its own reorder level',
                                   'Batch reserved for a district programme'])[1 + floor(random() * 3)::int], 'SOURCE_FACILITY', NULL, v_status);
                    ELSIF v_roll < 0.13 THEN
                        PERFORM set_config('medshare.event_time', (v_t + 1 + time '15:00')::timestamptz::text, true);
                        CALL sp_cancel_transfer(v_dst_im, v_tid,
                                                'Requirement met from a supplier delivery', NULL, v_status);
                    ELSE
                        PERFORM set_config('medshare.event_time', (v_t + 1 + time '16:00')::timestamptz::text, true);
                        CALL sp_approve_transfer(v_src_fm, v_tid, 'SOURCE_FACILITY', 'Approved', NULL, v_status);
                        IF (SELECT status FROM transfer_requests WHERE id = v_tid) = 'PENDING' THEN
                            PERFORM set_config('medshare.event_time', (v_t + 1 + time '18:30')::timestamptz::text, true);
                            CALL sp_approve_transfer(v_src_oa, v_tid, 'SOURCE_ORGANIZATION',
                                                     'Covered by inter-organisation agreement', NULL, v_status);
                        END IF;
                        PERFORM set_config('medshare.event_time', (v_t + 2 + time '10:00')::timestamptz::text, true);
                        CALL sp_dispatch_transfer(v_src_im, v_tid,
                                                  'Vehicle KA-' || lpad((10 + floor(random() * 50))::text, 2, '0') || '-SYN', NULL, v_status);
                        PERFORM set_config('medshare.event_time', (v_t + 3 + time '12:00')::timestamptz::text, true);
                        IF random() < 0.06 AND v_qty > 10 THEN
                            SELECT id INTO v_item FROM transfer_items WHERE transfer_id = v_tid;
                            CALL sp_receive_transfer(v_dst_im, v_tid,
                                jsonb_build_array(jsonb_build_object('item_id', v_item,
                                                                     'received', v_qty - 2, 'damaged', 2)),
                                'Two units crushed in transit', NULL, v_status);
                        ELSE
                            CALL sp_receive_transfer(v_dst_im, v_tid, NULL, 'Received in full', NULL, v_status);
                        END IF;
                    END IF;
                    v_ok := v_ok + 1;
                EXCEPTION WHEN OTHERS THEN
                    v_skipped := v_skipped + 1;          -- subtransaction rolled back; state stays consistent
                END;
                PERFORM set_config('medshare.event_time', (v_t + 1 + time '09:00')::timestamptz::text, true);
            END LOOP;
        END IF;
        v_prev := v_t;
    END LOOP;

    -- ==================================================== in-flight work ======
    -- Transfers in every open state, dated over the last few days.
    v_cnt := 0;
    PERFORM set_config('medshare.event_time', (v_today - 4 + time '09:00')::timestamptz::text, true);
    FOR n IN SELECT ss.* FROM v_shortage_status ss JOIN facilities f ON f.id = ss.facility_id
             WHERE ss.stock_status <> 'OK' AND f.facility_type <> 'WAREHOUSE'
             ORDER BY (ss.stock_status = 'CRITICAL') DESC, random() LIMIT 30 LOOP
        EXIT WHEN v_cnt >= 9;
        SELECT i.id AS inv, i.facility_id AS src, b.id AS batch_id, i.qty_available
          INTO s
        FROM inventory i
        JOIN medicine_batches b ON b.id = i.batch_id
        JOIN facilities sf ON sf.id = i.facility_id
        JOIN facilities df ON df.id = n.facility_id
        JOIN medicines m   ON m.id = b.medicine_id
        LEFT JOIN v_shortage_status src ON src.facility_id = i.facility_id AND src.medicine_id = b.medicine_id
        WHERE b.medicine_id = n.medicine_id AND i.facility_id <> n.facility_id
          AND b.status = 'ACTIVE' AND b.expiry_date >= v_today + 30 AND i.qty_available >= 20
          AND (src.facility_id IS NULL OR src.usable > src.reorder_threshold * 1.5)
          AND fn_is_transfer_authorised(i.facility_id, n.facility_id)
          AND fn_distance_km(i.facility_id, n.facility_id) <= sf.max_dispatch_radius_km
          AND (NOT m.requires_cold_chain OR (sf.has_cold_chain AND df.has_cold_chain))
          AND NOT EXISTS (SELECT 1 FROM transfer_requests t JOIN transfer_items ti ON ti.transfer_id = t.id
                          WHERE t.status IN ('PENDING', 'APPROVED', 'DISPATCHED') AND ti.batch_id = b.id AND t.destination_facility_id = n.facility_id)
        ORDER BY (sf.organization_id = df.organization_id) DESC, b.expiry_date
        LIMIT 1;
        CONTINUE WHEN NOT FOUND;
        v_qty := least(n.reorder_threshold - n.usable, floor(s.qty_available * 0.4)::integer);
        CONTINUE WHEN v_qty < 5;
        SELECT fm, im, oa INTO v_src_fm, v_src_im, v_src_oa FROM _actor a WHERE a.facility_id = s.src;
        SELECT im INTO v_dst_im FROM _actor a WHERE a.facility_id = n.facility_id;
        BEGIN
            PERFORM set_config('medshare.event_time', (v_today - 3 + (v_cnt % 3) + time '11:00')::timestamptz::text, true);
            v_tid := fn_create_transfer_request(v_dst_im, s.src, n.facility_id,
                         jsonb_build_array(jsonb_build_object('batch_id', s.batch_id, 'quantity', v_qty)),
                         format('%s below reorder level (%s of %s)', n.medicine_name, n.usable, n.reorder_threshold));
            IF v_cnt % 3 >= 1 THEN                                    -- facility-stage approval
                PERFORM set_config('medshare.event_time', (v_today - 3 + (v_cnt % 3) + time '15:00')::timestamptz::text, true);
                CALL sp_approve_transfer(v_src_fm, v_tid, 'SOURCE_FACILITY', 'Approved', NULL, v_status);
                IF v_status = 'PENDING' AND v_cnt <> 1 THEN          -- cross-org: organisation stage (v_cnt 1 left awaiting it)
                    PERFORM set_config('medshare.event_time', (v_today - 3 + (v_cnt % 3) + time '17:00')::timestamptz::text, true);
                    CALL sp_approve_transfer(v_src_oa, v_tid, 'SOURCE_ORGANIZATION', 'Covered by inter-organisation agreement', NULL, v_status);
                END IF;
            END IF;
            IF v_cnt % 3 = 2 AND (SELECT status FROM transfer_requests WHERE id = v_tid) = 'APPROVED' THEN   -- dispatched
                PERFORM set_config('medshare.event_time', (v_today - 1 + time '10:00')::timestamptz::text, true);
                CALL sp_dispatch_transfer(v_src_im, v_tid, 'Vehicle KA-41-SYN', NULL, v_status);
            END IF;
            v_cnt := v_cnt + 1;
        EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped + 1;
        END;
    END LOOP;

    -- Open stock requests not yet sourced.
    PERFORM set_config('medshare.event_time', (v_today - 1 + time '10:00')::timestamptz::text, true);
    FOR n IN SELECT ss.* FROM v_shortage_status ss
             WHERE ss.stock_status = 'CRITICAL'
               AND NOT EXISTS (SELECT 1 FROM stock_requests sr JOIN stock_request_items i ON i.stock_request_id = sr.id
                               WHERE sr.status = 'OPEN' AND sr.requesting_facility_id = ss.facility_id AND i.medicine_id = ss.medicine_id)
             ORDER BY ss.days_of_inventory NULLS FIRST LIMIT 4 LOOP
        SELECT im INTO v_dst_im FROM _actor a WHERE a.facility_id = n.facility_id;
        PERFORM fn_create_stock_request(v_dst_im, n.facility_id,
                    jsonb_build_array(jsonb_build_object('medicine_id', n.medicine_id, 'quantity', n.reorder_threshold - n.usable)),
                    'URGENT', v_today + 7, 'Synthetic request: critical shortage');
    END LOOP;

    -- Write off part of the expired stock (the rest stays on hand for expiry alerts).
    PERFORM set_config('medshare.event_time', (v_today - 2 + time '17:00')::timestamptz::text, true);
    FOR h IN SELECT i.id AS inv, i.facility_id, i.qty_available
             FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id
             WHERE b.expiry_date < v_today - 2 AND i.qty_available > 0 AND i.id % 2 = 0 ORDER BY i.id LOOP
        PERFORM fn_write_off_expired((SELECT im FROM _actor WHERE facility_id = h.facility_id), h.inv, h.qty_available,
                                     'Expired stock removed for destruction (synthetic)');
    END LOOP;

    -- Dispose of some damaged stock.
    FOR h IN SELECT i.id AS inv, i.facility_id, i.qty_damaged FROM inventory i WHERE i.qty_damaged > 0 AND i.id % 3 = 0 ORDER BY i.id LOOP
        PERFORM fn_dispose_damaged((SELECT im FROM _actor WHERE facility_id = h.facility_id), h.inv, h.qty_damaged,
                                   'Destroyed under supervision (synthetic)');
    END LOOP;

    -- One quarantined and one recalled batch (not part of open transfers).
    PERFORM set_config('medshare.event_time', (v_today - 1 + time '12:00')::timestamptz::text, true);
    FOR bt IN SELECT b.id, row_number() OVER (ORDER BY b.id) AS rn
              FROM medicine_batches b
              WHERE b.expiry_date > v_today + 200
                AND (SELECT count(*) FROM inventory i WHERE i.batch_id = b.id AND i.qty_available > 0) >= 3
                AND NOT EXISTS (SELECT 1 FROM transfer_items ti JOIN transfer_requests t ON t.id = ti.transfer_id
                                WHERE ti.batch_id = b.id AND t.status IN ('PENDING', 'APPROVED', 'DISPATCHED'))
              ORDER BY b.id LIMIT 2 LOOP
        PERFORM fn_set_batch_status(v_admin, bt.id,
            CASE WHEN bt.rn = 1 THEN 'QUARANTINED' ELSE 'RECALLED' END::batch_status,
            CASE WHEN bt.rn = 1 THEN 'Synthetic: pending quality test after temperature excursion'
                 ELSE 'Synthetic: manufacturer recall notice (dissolution failure)' END);
    END LOOP;

    PERFORM set_config('medshare.event_time', '', true);
    RAISE NOTICE 'activity seed: % shortage-driven transfers, % in-flight transfers, % attempts skipped', v_ok, v_cnt, v_skipped;
END $$;
