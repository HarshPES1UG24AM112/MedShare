-- =============================================================================
-- Database integrity tests. Self-contained fixtures, run in ONE transaction that
-- is rolled back at the end — the seeded database is never modified.
-- Each check prints "✓ …"; the first failure raises and aborts the run.
-- =============================================================================
BEGIN;
SET LOCAL client_min_messages = notice;

-- ------------------------------------------------------------------ harness --
CREATE TEMP TABLE _t (k text PRIMARY KEY, v bigint) ON COMMIT DROP;

CREATE FUNCTION pg_temp.tv(p_k text) RETURNS bigint LANGUAGE sql AS $$ SELECT v FROM _t WHERE k = p_k $$;
CREATE FUNCTION pg_temp.tset(p_k text, p_v bigint) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _t VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $$;

CREATE FUNCTION pg_temp.ok(p_name text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS TRUE THEN RAISE NOTICE '✓ %', p_name;
    ELSE RAISE EXCEPTION 'FAILED: %', p_name; END IF;
END $$;

-- Runs p_sql in a subtransaction; passes if it fails with the expected hint,
-- SQLSTATE or constraint name. The subtransaction's effects are rolled back.
CREATE FUNCTION pg_temp.rejects(p_name text, p_sql text, p_expect text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text; v_hint text; v_msg text; v_con text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT,
                                v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
        IF p_expect IN (v_hint, v_state, v_con) THEN
            RAISE NOTICE '✓ % → rejected (%)', p_name, p_expect;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAILED: % — expected %, got sqlstate=% hint=% constraint=% msg=%', p_name, p_expect, v_state, v_hint, v_con, v_msg;
    END;
    RAISE EXCEPTION 'FAILED: % — statement succeeded but should have been rejected', p_name;
END $$;

CREATE FUNCTION pg_temp.avail(p_facility bigint, p_batch bigint) RETURNS integer LANGUAGE sql AS
$$ SELECT qty_available FROM inventory WHERE facility_id = p_facility AND batch_id = p_batch $$;
CREATE FUNCTION pg_temp.reserved(p_facility bigint, p_batch bigint) RETURNS integer LANGUAGE sql AS
$$ SELECT qty_reserved FROM inventory WHERE facility_id = p_facility AND batch_id = p_batch $$;
CREATE FUNCTION pg_temp.inv(p_facility bigint, p_batch bigint) RETURNS bigint LANGUAGE sql AS
$$ SELECT id FROM inventory WHERE facility_id = p_facility AND batch_id = p_batch $$;

-- ----------------------------------------------------------------- fixtures --
DO $$
DECLARE
    v_region integer; v_a integer; v_b integer; v_c integer;
    v_f1 integer; v_f2 integer; v_fb integer; v_fc integer;
    v_med integer; v_mfr integer; v_inv bigint;
    v_hash text := '$2b$10$fixturefixturefixturefixtu';
    u record;
BEGIN
    INSERT INTO regions (code, name) VALUES ('TST', 'Test State') RETURNING id INTO v_region;
    INSERT INTO organizations (name, org_type, registration_number) VALUES ('Test Org A', 'HOSPITAL_NETWORK', 'TST-A') RETURNING id INTO v_a;
    INSERT INTO organizations (name, org_type, registration_number) VALUES ('Test Org B', 'PHARMACY_CHAIN', 'TST-B') RETURNING id INTO v_b;
    INSERT INTO organizations (name, org_type, registration_number) VALUES ('Test Org C', 'NGO', 'TST-C') RETURNING id INTO v_c;

    INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude, has_cold_chain)
    VALUES (v_a, v_region, 'FAC-901', 'Test Hospital One',  'HOSPITAL',                '1 Test Rd', 12.97, 77.59, true) RETURNING id INTO v_f1;
    INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude, has_cold_chain)
    VALUES (v_a, v_region, 'FAC-902', 'Test Clinic Two',    'COMMUNITY_HEALTH_CENTRE', '2 Test Rd', 13.00, 77.60, false) RETURNING id INTO v_f2;
    INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude)
    VALUES (v_b, v_region, 'FAC-903', 'Test Pharmacy B',    'PHARMACY',                '3 Test Rd', 12.98, 77.61) RETURNING id INTO v_fb;
    INSERT INTO facilities (organization_id, region_id, code, name, facility_type, address_line, latitude, longitude)
    VALUES (v_c, v_region, 'FAC-904', 'Test NGO Clinic C',  'COMMUNITY_HEALTH_CENTRE', '4 Test Rd', 12.96, 77.58) RETURNING id INTO v_fc;
    PERFORM pg_temp.tset('f1', v_f1); PERFORM pg_temp.tset('f2', v_f2);
    PERFORM pg_temp.tset('fb', v_fb); PERFORM pg_temp.tset('fc', v_fc);
    PERFORM pg_temp.tset('org_a', v_a); PERFORM pg_temp.tset('org_c', v_c);

    FOR u IN SELECT * FROM (VALUES
        ('fm1', 'FACILITY_MANAGER', v_f1, NULL::integer), ('im1', 'INVENTORY_MANAGER', v_f1, NULL),
        ('fm2', 'FACILITY_MANAGER', v_f2, NULL),          ('im2', 'INVENTORY_MANAGER', v_f2, NULL),
        ('imb', 'INVENTORY_MANAGER', v_fb, NULL),         ('imc', 'INVENTORY_MANAGER', v_fc, NULL),
        ('orga', 'ORG_ADMIN', NULL, v_a),                 ('aud', 'AUDITOR', NULL, NULL),
        ('sys', 'SYSTEM_ADMIN', NULL, NULL)) x(k, role, fac, org)
    LOOP
        INSERT INTO users (email, password_hash, full_name) VALUES (u.k || '@test.medshare', v_hash, 'Test ' || u.k)
        RETURNING id INTO v_inv;
        PERFORM pg_temp.tset(u.k, v_inv);
        IF u.fac IS NOT NULL THEN
            INSERT INTO facility_users (user_id, facility_id, role_id) SELECT v_inv, u.fac, id FROM roles WHERE code = u.role;
        ELSE
            INSERT INTO user_roles (user_id, role_id, organization_id) SELECT v_inv, id, u.org FROM roles WHERE code = u.role;
        END IF;
    END LOOP;

    INSERT INTO organization_agreements (organization_a_id, organization_b_id, valid_from, created_by)
    VALUES (least(v_a, v_c), greatest(v_a, v_c), current_date - 10, pg_temp.tv('sys'));

    INSERT INTO substances (name) VALUES ('Testamol') RETURNING id INTO v_med;
    INSERT INTO medicines (code, name, dosage_form, category_id, dispensing_unit_id)
    VALUES ('MED-9001', 'Testamol', 'TABLET', (SELECT id FROM medicine_categories ORDER BY id LIMIT 1), (SELECT id FROM medicine_units WHERE code = 'TAB'))
    RETURNING id INTO v_med;
    INSERT INTO medicine_ingredients VALUES (v_med, (SELECT id FROM substances WHERE name = 'Testamol'), 500, 'mg');
    PERFORM pg_temp.tset('med', v_med);
    SELECT id INTO v_mfr FROM manufacturers ORDER BY id LIMIT 1;
    PERFORM pg_temp.tset('mfr', v_mfr);

    -- Good batch: 1000 at F1
    CALL sp_receive_stock(pg_temp.tv('im1'), v_f1, v_med, v_mfr, 'TST-GOOD-1', current_date - 100, current_date + 300, 1.50, 1000, 'TEST-GRN-1', NULL, v_inv);
    PERFORM pg_temp.tset('good', (SELECT id FROM medicine_batches WHERE batch_number = 'TST-GOOD-1'));
    -- Second good batch: 200 at F1 (for multi-item rollback test)
    CALL sp_receive_stock(pg_temp.tv('im1'), v_f1, v_med, v_mfr, 'TST-GOOD-2', current_date - 90, current_date + 320, 1.60, 200, 'TEST-GRN-2', NULL, v_inv);
    PERFORM pg_temp.tset('good2', (SELECT id FROM medicine_batches WHERE batch_number = 'TST-GOOD-2'));
    -- Near-expiry batch (5 days left, below the 14-day minimum shelf life)
    CALL sp_receive_stock(pg_temp.tv('im1'), v_f1, v_med, v_mfr, 'TST-NEAR-1', current_date - 700, current_date + 5, 1.20, 300, 'TEST-GRN-3', NULL, v_inv);
    PERFORM pg_temp.tset('near', (SELECT id FROM medicine_batches WHERE batch_number = 'TST-NEAR-1'));
    -- Expired batch: received (back-dated) while still valid
    PERFORM set_config('medshare.event_time', (current_date - 400)::timestamptz::text, true);
    CALL sp_receive_stock(pg_temp.tv('im1'), v_f1, v_med, v_mfr, 'TST-EXP-1', current_date - 700, current_date - 10, 1.10, 150, 'TEST-GRN-4', NULL, v_inv);
    PERFORM set_config('medshare.event_time', '', true);
    PERFORM pg_temp.tset('expired', (SELECT id FROM medicine_batches WHERE batch_number = 'TST-EXP-1'));
    RAISE NOTICE '— fixtures ready (4 facilities, 9 users, 4 batches)';
END $$;

-- ===================================================== 1. ledger & balances ==
DO $$
BEGIN
    RAISE NOTICE '— ledger, balances, append-only';
    PERFORM pg_temp.ok('goods receipt sets available stock (1000)', pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = 1000);
    PERFORM pg_temp.ok('receipt wrote a RECEIPT movement and an audit entry',
        EXISTS (SELECT 1 FROM inventory_movements WHERE inventory_id = pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good')) AND movement_type = 'RECEIPT' AND quantity = 1000)
        AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'STOCK_RECEIVED' AND entity_id = pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good'))::text));

    PERFORM pg_temp.rejects('direct UPDATE of inventory (even as superuser)',
        format('UPDATE inventory SET qty_available = 5 WHERE id = %s', pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good'))), 'INVENTORY_DIRECT_WRITE');
    PERFORM pg_temp.rejects('DELETE of an inventory row',
        format('DELETE FROM inventory WHERE id = %s', pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good'))), 'INVENTORY_DIRECT_WRITE');
    PERFORM pg_temp.rejects('INSERT of inventory with a non-zero balance',
        format('INSERT INTO inventory (facility_id, batch_id, qty_available) VALUES (%s, %s, 10)', pg_temp.tv('f2'), pg_temp.tv('good')), 'INVENTORY_DIRECT_WRITE');
    PERFORM pg_temp.rejects('UPDATE of a ledger movement',
        'UPDATE inventory_movements SET quantity = 1 WHERE id = (SELECT max(id) FROM inventory_movements)', 'APPEND_ONLY');
    PERFORM pg_temp.rejects('DELETE of a ledger movement',
        'DELETE FROM inventory_movements WHERE id = (SELECT max(id) FROM inventory_movements)', 'APPEND_ONLY');
    PERFORM pg_temp.rejects('UPDATE of an audit log entry', 'UPDATE audit_logs SET action = ''X'' WHERE id = (SELECT max(id) FROM audit_logs)', 'APPEND_ONLY');
    PERFORM pg_temp.rejects('TRUNCATE of the audit log', 'TRUNCATE audit_logs', 'APPEND_ONLY');
    PERFORM pg_temp.rejects('DAMAGE movement without a reason',
        format('INSERT INTO inventory_movements (inventory_id, movement_type, quantity, performed_by) VALUES (%s, ''DAMAGE'', 1, %s)',
               pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good')), pg_temp.tv('im1')), 'MOVEMENT_REQUIRES_REASON');
    PERFORM pg_temp.rejects('RESERVE movement without a transfer item',
        format('INSERT INTO inventory_movements (inventory_id, movement_type, quantity, performed_by) VALUES (%s, ''RESERVE'', 1, %s)',
               pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good')), pg_temp.tv('im1')), 'MOVEMENT_REQUIRES_TRANSFER');
    PERFORM pg_temp.rejects('raw movement that would make stock negative hits the CHECK constraint',
        format('INSERT INTO inventory_movements (inventory_id, movement_type, quantity, performed_by) VALUES (%s, ''DISPENSE'', 999999, %s)',
               pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good')), pg_temp.tv('im1')), 'ck_inventory_available_nonneg');
    PERFORM pg_temp.rejects('dispensing more than available',
        format('SELECT fn_record_dispense(%s, %s, 5000)', pg_temp.tv('im1'), pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good'))), 'INSUFFICIENT_STOCK');
    PERFORM pg_temp.ok('failed operations left the balance unchanged (1000)', pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = 1000);
END $$;

-- ================================================= 2. full transfer lifecycle ==
DO $$
DECLARE
    v_t bigint; v_s transfer_status;
BEGIN
    RAISE NOTICE '— transfer lifecycle (request → approve → dispatch → receive)';
    v_t := fn_create_transfer_request(pg_temp.tv('im2'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
               jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 100)), 'Lifecycle test');
    PERFORM pg_temp.tset('t_life', v_t);
    PERFORM pg_temp.ok('request is PENDING and does not reserve stock',
        (SELECT status FROM transfer_requests WHERE id = v_t) = 'PENDING'
        AND pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good')) = 0 AND pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = 1000);

    CALL sp_approve_transfer(pg_temp.tv('fm1'), v_t, 'SOURCE_FACILITY', 'ok', NULL, v_s);
    PERFORM pg_temp.ok('approval reserves stock atomically (available 900, reserved 100)',
        v_s = 'APPROVED' AND pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = 900 AND pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good')) = 100);

    CALL sp_dispatch_transfer(pg_temp.tv('im1'), v_t, 'Van 1', NULL, v_s);
    PERFORM pg_temp.ok('dispatch removes the reservation (reserved 0)',
        v_s = 'DISPATCHED' AND pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good')) = 0 AND pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = 900);

    CALL sp_receive_transfer(pg_temp.tv('im2'), v_t, NULL, 'All good', NULL, v_s);
    PERFORM pg_temp.ok('receipt adds 100 at the destination for the SAME batch',
        v_s = 'RECEIVED' AND pg_temp.avail(pg_temp.tv('f2'), pg_temp.tv('good')) = 100);
    PERFORM pg_temp.ok('status history has 4 rows, previous status derived by LAG()',
        (SELECT count(*) FROM transfer_status_history WHERE transfer_id = v_t) = 4
        AND (SELECT from_status FROM v_transfer_timeline WHERE transfer_id = v_t AND to_status = 'RECEIVED') = 'DISPATCHED');
    PERFORM pg_temp.ok('ledger has RESERVE, TRANSFER_OUT and TRANSFER_IN for the transfer',
        (SELECT array_agg(mv.movement_type ORDER BY mv.id) FROM inventory_movements mv JOIN transfer_items ti ON ti.id = mv.transfer_item_id
         WHERE ti.transfer_id = v_t) = ARRAY['RESERVE', 'TRANSFER_OUT', 'TRANSFER_IN']);
    PERFORM pg_temp.ok('every step is in the audit log',
        (SELECT count(DISTINCT action) FROM audit_logs WHERE entity_type = 'TRANSFER' AND entity_id = v_t::text
         AND action IN ('TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_DISPATCHED', 'TRANSFER_RECEIVED')) = 4);

    PERFORM pg_temp.rejects('receiving the same transfer twice', format('CALL sp_receive_transfer(%s, %s, NULL, NULL, NULL, NULL)', pg_temp.tv('im2'), v_t), 'INVALID_STATE');
    PERFORM pg_temp.rejects('dispatching a received transfer', format('CALL sp_dispatch_transfer(%s, %s, NULL, NULL, NULL)', pg_temp.tv('im1'), v_t), 'INVALID_STATE');
END $$;

-- ============================================ 3. double allocation & rollback ==
DO $$
DECLARE
    v_ta bigint; v_tb bigint; v_s transfer_status; v_before integer;
BEGIN
    RAISE NOTICE '— reservation contention and all-or-nothing rollback';
    v_before := pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good'));          -- 900
    v_ta := fn_create_transfer_request(pg_temp.tv('im2'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
                jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 700)));
    v_tb := fn_create_transfer_request(pg_temp.tv('imc'), pg_temp.tv('f1')::integer, pg_temp.tv('fc')::integer,
                jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 600)));
    PERFORM pg_temp.ok('both requests accepted (requests do not consume stock)', v_ta IS NOT NULL AND v_tb IS NOT NULL);

    CALL sp_approve_transfer(pg_temp.tv('fm1'), v_ta, 'SOURCE_FACILITY', NULL, NULL, v_s);
    PERFORM pg_temp.ok('first approval reserves 700', pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good')) = 700);
    -- T_b is cross-org (A→C): facility stage, then organisation stage triggers reservation
    CALL sp_approve_transfer(pg_temp.tv('fm1'), v_tb, 'SOURCE_FACILITY', NULL, NULL, v_s);
    PERFORM pg_temp.ok('cross-org transfer stays PENDING after facility approval only', v_s = 'PENDING');
    PERFORM pg_temp.rejects('second reservation exceeding remaining stock (600 > 200)',
        format('CALL sp_approve_transfer(%s, %s, ''SOURCE_ORGANIZATION'', NULL, NULL, NULL)', pg_temp.tv('orga'), v_tb), 'INSUFFICIENT_STOCK');
    PERFORM pg_temp.ok('failed approval rolled back completely (no org approval row, still PENDING, reserved 700 only)',
        NOT EXISTS (SELECT 1 FROM transfer_approvals WHERE transfer_id = v_tb AND stage = 'SOURCE_ORGANIZATION')
        AND (SELECT status FROM transfer_requests WHERE id = v_tb) = 'PENDING'
        AND pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good')) = 700
        AND pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = v_before - 700);

    -- Multi-item transfer where the 2nd line becomes unavailable before approval.
    v_ta := fn_create_transfer_request(pg_temp.tv('im2'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
                jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 50),
                                  jsonb_build_object('batch_id', pg_temp.tv('good2'), 'quantity', 150)));
    PERFORM fn_record_dispense(pg_temp.tv('im1'), pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good2')), 100);   -- good2: 200 → 100
    v_before := pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good'));
    PERFORM pg_temp.rejects('multi-item approval with one short line',
        format('CALL sp_approve_transfer(%s, %s, ''SOURCE_FACILITY'', NULL, NULL, NULL)', pg_temp.tv('fm1'), v_ta), 'INSUFFICIENT_STOCK');
    PERFORM pg_temp.ok('no partial reservation: the first line''s stock is untouched and no RESERVE rows exist',
        pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good')) = v_before
        AND NOT EXISTS (SELECT 1 FROM inventory_movements mv JOIN transfer_items ti ON ti.id = mv.transfer_item_id WHERE ti.transfer_id = v_ta));
    PERFORM pg_temp.tset('t_multi', v_ta);
END $$;

-- ====================================================== 4. permissions & SoD ==
DO $$
DECLARE
    v_t bigint;
BEGIN
    RAISE NOTICE '— authorisation enforced inside the database';
    v_t := pg_temp.tv('t_multi');
    PERFORM pg_temp.rejects('inventory manager cannot approve', format('CALL sp_approve_transfer(%s, %s, ''SOURCE_FACILITY'', NULL, NULL, NULL)', pg_temp.tv('im1'), v_t), 'FORBIDDEN');
    PERFORM pg_temp.rejects('destination facility manager cannot approve', format('CALL sp_approve_transfer(%s, %s, ''SOURCE_FACILITY'', NULL, NULL, NULL)', pg_temp.tv('fm2'), v_t), 'FORBIDDEN');
    PERFORM pg_temp.rejects('system administrator is not an operational approver', format('CALL sp_approve_transfer(%s, %s, ''SOURCE_FACILITY'', NULL, NULL, NULL)', pg_temp.tv('sys'), v_t), 'FORBIDDEN');
    PERFORM pg_temp.rejects('auditor cannot receive stock',
        format('CALL sp_receive_stock(%s, %s, %s, %s, ''TST-AUD-1'', current_date - 10, current_date + 100, 1, 10, NULL, NULL, NULL)',
               pg_temp.tv('aud'), pg_temp.tv('f1'), pg_temp.tv('med'), pg_temp.tv('mfr')), 'FORBIDDEN');
    PERFORM pg_temp.rejects('staff of another facility cannot dispense here',
        format('SELECT fn_record_dispense(%s, %s, 1)', pg_temp.tv('im2'), pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good'))), 'FORBIDDEN');
    -- Push transfer created by the source manager, who then tries to approve it.
    v_t := fn_create_transfer_request(pg_temp.tv('fm1'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
               jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 5)));
    PERFORM pg_temp.rejects('requester cannot approve their own transfer', format('CALL sp_approve_transfer(%s, %s, ''SOURCE_FACILITY'', NULL, NULL, NULL)', pg_temp.tv('fm1'), v_t), 'SELF_APPROVAL');
    PERFORM pg_temp.rejects('facility with no agreement cannot request (partner authorisation)',
        format('SELECT fn_create_transfer_request(%s, %s, %s, ''[{"batch_id": %s, "quantity": 5}]'')', pg_temp.tv('imb'), pg_temp.tv('f1'), pg_temp.tv('fb'), pg_temp.tv('good')), 'PARTNER_NOT_AUTHORISED');
    PERFORM pg_temp.rejects('organisation stage is not used for same-organisation transfers',
        format('CALL sp_approve_transfer(%s, %s, ''SOURCE_ORGANIZATION'', NULL, NULL, NULL)', pg_temp.tv('orga'), v_t), 'STAGE_NOT_REQUIRED');
    PERFORM pg_temp.ok('fn_user_facility_ids scopes reads (fm1 sees only FAC-901; org admin sees both org-A facilities)',
        ARRAY(SELECT fn_user_facility_ids(pg_temp.tv('fm1')) ORDER BY 1) = ARRAY[pg_temp.tv('f1')::integer]
        AND ARRAY(SELECT fn_user_facility_ids(pg_temp.tv('orga')) ORDER BY 1) = ARRAY[pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer]);
END $$;

-- ========================================== 5. state machine & batch rules ==
DO $$
DECLARE
    v_t bigint; v_s transfer_status;
BEGIN
    RAISE NOTICE '— state machine, expiry and recall rules';
    PERFORM pg_temp.rejects('status change outside the procedures (no actor)',
        format('UPDATE transfer_requests SET status = ''CANCELLED'' WHERE id = %s', pg_temp.tv('t_multi')), 'ACTOR_REQUIRED');
    PERFORM fn_set_actor(pg_temp.tv('fm1'));
    PERFORM pg_temp.rejects('illegal transition PENDING → RECEIVED',
        format('UPDATE transfer_requests SET status = ''RECEIVED'' WHERE id = %s', pg_temp.tv('t_multi')), 'INVALID_STATE');
    PERFORM pg_temp.rejects('changing a transfer''s route',
        format('UPDATE transfer_requests SET destination_facility_id = %s WHERE id = %s', pg_temp.tv('fc'), pg_temp.tv('t_multi')), 'IMMUTABLE_FIELD');
    PERFORM pg_temp.rejects('inserting a transfer that is already APPROVED',
        format('INSERT INTO transfer_requests (code, source_facility_id, destination_facility_id, requested_by, status) VALUES (''TRF-2099-99999'', %s, %s, %s, ''APPROVED'')',
               pg_temp.tv('f1'), pg_temp.tv('f2'), pg_temp.tv('im2')), 'INVALID_STATE');
    PERFORM pg_temp.rejects('dispatching a PENDING transfer', format('CALL sp_dispatch_transfer(%s, %s, NULL, NULL, NULL)', pg_temp.tv('im1'), pg_temp.tv('t_multi')), 'INVALID_STATE');
    PERFORM pg_temp.rejects('rejecting without a reason', format('CALL sp_reject_transfer(%s, %s, ''  '', ''SOURCE_FACILITY'', NULL, NULL)', pg_temp.tv('fm1'), pg_temp.tv('t_multi')), 'REASON_REQUIRED');
    CALL sp_reject_transfer(pg_temp.tv('fm1'), pg_temp.tv('t_multi'), 'Line 2 unavailable', 'SOURCE_FACILITY', NULL, v_s);
    PERFORM pg_temp.ok('rejection records the decision and reason',
        v_s = 'REJECTED' AND (SELECT rejection_reason FROM transfer_requests WHERE id = pg_temp.tv('t_multi')) = 'Line 2 unavailable'
        AND EXISTS (SELECT 1 FROM transfer_approvals WHERE transfer_id = pg_temp.tv('t_multi') AND decision = 'REJECTED'));

    PERFORM pg_temp.rejects('transferring an expired batch',
        format('SELECT fn_create_transfer_request(%s, %s, %s, ''[{"batch_id": %s, "quantity": 5}]'')', pg_temp.tv('im2'), pg_temp.tv('f1'), pg_temp.tv('f2'), pg_temp.tv('expired')), 'BATCH_NOT_ELIGIBLE');
    PERFORM pg_temp.rejects('transferring a batch with < 14 days shelf life',
        format('SELECT fn_create_transfer_request(%s, %s, %s, ''[{"batch_id": %s, "quantity": 5}]'')', pg_temp.tv('im2'), pg_temp.tv('f1'), pg_temp.tv('f2'), pg_temp.tv('near')), 'BATCH_NOT_ELIGIBLE');
    PERFORM pg_temp.rejects('dispensing expired stock',
        format('SELECT fn_record_dispense(%s, %s, 1)', pg_temp.tv('im1'), pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('expired'))), 'BATCH_NOT_ELIGIBLE');
    PERFORM pg_temp.rejects('writing off stock that has not expired',
        format('SELECT fn_write_off_expired(%s, %s, 1)', pg_temp.tv('im1'), pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good'))), 'BATCH_NOT_EXPIRED');
    PERFORM fn_write_off_expired(pg_temp.tv('im1'), pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('expired')), 150);
    PERFORM pg_temp.ok('expired stock written off (available 0, audited)',
        pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('expired')) = 0
        AND EXISTS (SELECT 1 FROM audit_logs WHERE action = 'INVENTORY_EXPIRY_WRITE_OFF' AND entity_id = pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('expired'))::text));
    PERFORM pg_temp.rejects('receiving an expired batch',
        format('CALL sp_receive_stock(%s, %s, %s, %s, ''TST-OLD-9'', current_date - 800, current_date - 1, 1, 10, NULL, NULL, NULL)',
               pg_temp.tv('im1'), pg_temp.tv('f1'), pg_temp.tv('med'), pg_temp.tv('mfr')), 'BATCH_EXPIRED');

    -- Recall between approval and dispatch.
    v_t := fn_create_transfer_request(pg_temp.tv('im2'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
               jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good2'), 'quantity', 40)));
    CALL sp_approve_transfer(pg_temp.tv('fm1'), v_t, 'SOURCE_FACILITY', NULL, NULL, v_s);
    PERFORM fn_set_batch_status(pg_temp.tv('sys'), pg_temp.tv('good2'), 'RECALLED', 'Manufacturer recall (test)');
    PERFORM pg_temp.rejects('dispatching a batch recalled after approval', format('CALL sp_dispatch_transfer(%s, %s, NULL, NULL, NULL)', pg_temp.tv('im1'), v_t), 'BATCH_RECALLED');
    PERFORM pg_temp.ok('transfer is still APPROVED with its reservation intact',
        (SELECT status FROM transfer_requests WHERE id = v_t) = 'APPROVED' AND pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good2')) = 40);
    CALL sp_cancel_transfer(pg_temp.tv('im2'), v_t, 'Batch recalled', NULL, v_s);
    PERFORM pg_temp.ok('cancelling releases the reservation (RELEASE movement)',
        v_s = 'CANCELLED' AND pg_temp.reserved(pg_temp.tv('f1'), pg_temp.tv('good2')) = 0 AND pg_temp.avail(pg_temp.tv('f1'), pg_temp.tv('good2')) = 100);
    PERFORM pg_temp.rejects('only platform administrators can recall', format('SELECT fn_set_batch_status(%s, %s, ''QUARANTINED'', ''test'')', pg_temp.tv('fm1'), pg_temp.tv('good')), 'FORBIDDEN');
END $$;

-- ============================================================ 6. idempotency ==
DO $$
DECLARE
    v_key uuid := gen_random_uuid(); v_t1 bigint; v_t2 bigint; v_s transfer_status; v_dkey uuid := gen_random_uuid(); v_lines jsonb;
BEGIN
    RAISE NOTICE '— idempotency keys';
    v_t1 := fn_create_transfer_request(pg_temp.tv('im2'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
                jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 10)), NULL, NULL, v_key);
    v_t2 := fn_create_transfer_request(pg_temp.tv('im2'), pg_temp.tv('f1')::integer, pg_temp.tv('f2')::integer,
                jsonb_build_array(jsonb_build_object('batch_id', pg_temp.tv('good'), 'quantity', 10)), NULL, NULL, v_key);
    PERFORM pg_temp.ok('retrying a create with the same key returns the same transfer (no duplicate)',
        v_t1 = v_t2 AND (SELECT count(*) FROM idempotency_keys WHERE idem_key = v_key) = 1);
    PERFORM pg_temp.rejects('same key with a different payload',
        format('SELECT fn_create_transfer_request(%s, %s, %s, ''[{"batch_id": %s, "quantity": 11}]'', NULL, NULL, %L)',
               pg_temp.tv('im2'), pg_temp.tv('f1'), pg_temp.tv('f2'), pg_temp.tv('good'), v_key), 'IDEMPOTENCY_KEY_REUSED');
    CALL sp_approve_transfer(pg_temp.tv('fm1'), v_t1, 'SOURCE_FACILITY', NULL, NULL, v_s);
    CALL sp_dispatch_transfer(pg_temp.tv('im1'), v_t1, NULL, v_dkey, v_s);
    CALL sp_dispatch_transfer(pg_temp.tv('im1'), v_t1, NULL, v_dkey, v_s);      -- client retry
    PERFORM pg_temp.ok('retried dispatch is a no-op returning DISPATCHED (one TRANSFER_OUT)',
        v_s = 'DISPATCHED' AND (SELECT count(*) FROM inventory_movements mv JOIN transfer_items ti ON ti.id = mv.transfer_item_id
                                WHERE ti.transfer_id = v_t1 AND mv.movement_type = 'TRANSFER_OUT') = 1);
    PERFORM pg_temp.rejects('receipt lines that do not add up',
        format('CALL sp_receive_transfer(%s, %s, ''[{"item_id": %s, "received": 5, "damaged": 1}]'', NULL, NULL, NULL)',
               pg_temp.tv('im2'), v_t1, (SELECT id FROM transfer_items WHERE transfer_id = v_t1)), 'RECEIPT_MISMATCH');
    v_lines := jsonb_build_array(jsonb_build_object('item_id', (SELECT id FROM transfer_items WHERE transfer_id = v_t1), 'received', 8, 'damaged', 2));
    CALL sp_receive_transfer(pg_temp.tv('im2'), v_t1, v_lines, 'Two crushed', NULL, v_s);
    PERFORM pg_temp.ok('partial damage in transit goes to the damaged bucket',
        (SELECT qty_damaged FROM inventory WHERE facility_id = pg_temp.tv('f2') AND batch_id = pg_temp.tv('good')) = 2);
END $$;

-- ================================================= 7. alerts & engine rules ==
DO $$
DECLARE
    v_n integer; v_transfers bigint; v_inv bigint;
BEGIN
    RAISE NOTICE '— shortage and expiry alerts, engine safety';
    INSERT INTO facility_medicine_settings (facility_id, medicine_id, min_stock_level, reorder_threshold, safety_stock, estimated_daily_consumption)
    VALUES (pg_temp.tv('fc'), pg_temp.tv('med'), 50, 100, 20, 5);
    PERFORM pg_temp.ok('configuring a policy for a facility with no stock opens a CRITICAL alert',
        (SELECT severity FROM shortage_alerts WHERE facility_id = pg_temp.tv('fc') AND medicine_id = pg_temp.tv('med') AND status = 'OPEN') = 'CRITICAL');
    CALL sp_receive_stock(pg_temp.tv('imc'), pg_temp.tv('fc')::integer, pg_temp.tv('med')::integer, pg_temp.tv('mfr')::integer,
                          'TST-C-1', current_date - 30, current_date + 400, 1.40, 300, NULL, NULL, v_inv);
    PERFORM pg_temp.ok('stock above the reorder level resolves it automatically',
        NOT EXISTS (SELECT 1 FROM shortage_alerts WHERE facility_id = pg_temp.tv('fc') AND medicine_id = pg_temp.tv('med') AND status <> 'RESOLVED'));
    PERFORM fn_record_dispense(pg_temp.tv('imc'), v_inv, 230);              -- 300 → 70 (LOW)
    PERFORM pg_temp.ok('falling below reorder (70 < 100) opens a LOW alert',
        (SELECT severity FROM shortage_alerts WHERE facility_id = pg_temp.tv('fc') AND medicine_id = pg_temp.tv('med') AND status = 'OPEN') = 'LOW');
    PERFORM fn_record_dispense(pg_temp.tv('imc'), v_inv, 40);               -- 70 → 30 (CRITICAL)
    PERFORM pg_temp.ok('further drop escalates the same alert to CRITICAL (one open alert)',
        (SELECT count(*) FROM shortage_alerts WHERE facility_id = pg_temp.tv('fc') AND medicine_id = pg_temp.tv('med') AND status <> 'RESOLVED') = 1
        AND (SELECT severity FROM shortage_alerts WHERE facility_id = pg_temp.tv('fc') AND medicine_id = pg_temp.tv('med') AND status = 'OPEN') = 'CRITICAL');

    PERFORM fn_generate_expiry_alerts();
    v_n := fn_generate_expiry_alerts();
    PERFORM pg_temp.ok('expiry alert generation is idempotent (second run creates 0)', v_n = 0);
    PERFORM pg_temp.ok('near-expiry fixture batch has a WITHIN_7_DAYS alert',
        EXISTS (SELECT 1 FROM expiry_alerts WHERE inventory_id = pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('near')) AND level = 'WITHIN_7_DAYS' AND status = 'OPEN'));

    SELECT count(*) INTO v_transfers FROM transfer_requests;
    v_n := fn_generate_recommendations(NULL);
    PERFORM pg_temp.ok(format('engine generated %s recommendations and created no transfers', v_n),
        v_n > 0 AND (SELECT count(*) FROM transfer_requests) = v_transfers);
    PERFORM pg_temp.ok('no recommendation uses an ineligible, unauthorised, out-of-range or cold-chain-violating source',
        NOT EXISTS (
            SELECT 1 FROM redistribution_recommendations r
            JOIN inventory i ON i.id = r.source_inventory_id JOIN medicine_batches b ON b.id = i.batch_id
            JOIN medicines m ON m.id = b.medicine_id JOIN facilities s ON s.id = i.facility_id JOIN facilities d ON d.id = r.destination_facility_id
            WHERE r.status = 'OPEN'
              AND (b.status <> 'ACTIVE' OR b.expiry_date < current_date + 14
                   OR NOT fn_is_transfer_authorised(s.id, d.id)
                   OR fn_distance_km(s.id, d.id) > s.max_dispatch_radius_km
                   OR (m.requires_cold_chain AND NOT (s.has_cold_chain AND d.has_cold_chain))
                   OR r.recommended_quantity > i.qty_available)));
END $$;

-- ========================================== 8. cross-row integrity triggers ==
DO $s8$
DECLARE
    v_cat integer; v_child integer;
BEGIN
    RAISE NOTICE '— hierarchy, role-scope, composition and agreement constraints';
    PERFORM pg_temp.rejects('facility-level role granted at organisation level',
        format('INSERT INTO user_roles (user_id, role_id, organization_id) SELECT %s, id, %s FROM roles WHERE code = ''FACILITY_MANAGER''', pg_temp.tv('aud'), pg_temp.tv('org_a')), 'INVALID_ROLE_SCOPE');
    PERFORM pg_temp.rejects('organisation admin granted without an organisation',
        format('INSERT INTO user_roles (user_id, role_id) SELECT %s, id FROM roles WHERE code = ''ORG_ADMIN''', pg_temp.tv('aud')), 'INVALID_ROLE_SCOPE');
    INSERT INTO medicine_categories (name) VALUES ('Test parent') RETURNING id INTO v_cat;
    INSERT INTO medicine_categories (parent_id, name) VALUES (v_cat, 'Test child') RETURNING id INTO v_child;
    PERFORM pg_temp.rejects('category hierarchy cycle', format('UPDATE medicine_categories SET parent_id = %s WHERE id = %s', v_child, v_cat), 'HIERARCHY_CYCLE');
    PERFORM pg_temp.rejects('medicine without any ingredient (checked at commit)',
        format($q$DO $d$ BEGIN
            INSERT INTO medicines (code, name, dosage_form, category_id, dispensing_unit_id) VALUES ('MED-9002', 'Empty', 'TABLET', %s, (SELECT id FROM medicine_units LIMIT 1));
            SET CONSTRAINTS ALL IMMEDIATE; END $d$$q$, v_cat), 'MEDICINE_WITHOUT_INGREDIENT');
    PERFORM pg_temp.rejects('duplicate medicine composition (same form + ingredients)',
        format($q$DO $d$ DECLARE m integer; BEGIN
            INSERT INTO medicines (code, name, dosage_form, category_id, dispensing_unit_id) VALUES ('MED-9003', 'Testamol copy', 'TABLET', %s, (SELECT id FROM medicine_units WHERE code = 'TAB')) RETURNING id INTO m;
            INSERT INTO medicine_ingredients VALUES (m, (SELECT id FROM substances WHERE name = 'Testamol'), 500, 'mg');
            SET CONSTRAINTS ALL IMMEDIATE; END $d$$q$, v_cat), 'DUPLICATE_MEDICINE');
    PERFORM pg_temp.rejects('overlapping agreement period for the same organisation pair',
        format('INSERT INTO organization_agreements (organization_a_id, organization_b_id, valid_from, created_by) VALUES (%s, %s, current_date, %s)',
               least(pg_temp.tv('org_a'), pg_temp.tv('org_c')), greatest(pg_temp.tv('org_a'), pg_temp.tv('org_c')), pg_temp.tv('sys')), 'ex_agreement_no_overlap');
    PERFORM pg_temp.rejects('threshold order (minimum above reorder level)',
        format('INSERT INTO facility_medicine_settings VALUES (%s, %s, 500, 100, 10, 1)', pg_temp.tv('f2'), pg_temp.tv('med')), 'ck_settings_min_le_reorder');
END $s8$;

-- ===================================================== 9. reconciliation ==
DO $$
DECLARE
    v_n integer;
BEGIN
    RAISE NOTICE '— reconciliation';
    SELECT count(*) INTO v_n FROM fn_reconcile_inventory();
    PERFORM pg_temp.ok('balances equal ledger sums and reservations equal open transfer items (0 discrepancies)', v_n = 0);

    -- Simulate tampering that bypasses the ledger trigger (superuser only) and prove it is detected.
    ALTER TABLE inventory_movements DISABLE TRIGGER trg_inventory_movements_apply;
    INSERT INTO inventory_movements (inventory_id, movement_type, quantity, performed_by)
    VALUES (pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good')), 'RECEIPT', 7, pg_temp.tv('im1'));
    ALTER TABLE inventory_movements ENABLE TRIGGER trg_inventory_movements_apply;
    PERFORM pg_temp.ok('a movement that bypassed the balance trigger is detected (LEDGER_AVAILABLE off by 7)',
        EXISTS (SELECT 1 FROM fn_reconcile_inventory() WHERE check_name = 'LEDGER_AVAILABLE'
                AND inventory_id = pg_temp.inv(pg_temp.tv('f1'), pg_temp.tv('good')) AND expected - actual = 7));
    RAISE NOTICE '— all integrity checks passed';
END $$;

ROLLBACK;
