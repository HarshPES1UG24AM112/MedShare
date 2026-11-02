-- =============================================================================
-- 004 — stored procedures & functions
--
-- Every routine that changes stock or transfer state:
--   * is SECURITY DEFINER (runs as medshare_owner; the app role has no direct
--     write privilege on inventory, movements or transfer tables),
--   * re-checks the caller's permission in the database (p_actor),
--   * runs as ONE transaction (the caller's), so any failure rolls back all,
--   * locks in the global order: transfer row → inventory rows by ascending id,
--   * optionally takes an idempotency key (exactly-once on client retry).
-- Isolation: READ COMMITTED + explicit row locks for writers (see design §9).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers (not granted to the app role)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_lock_transfer(p_transfer bigint) RETURNS transfer_requests
LANGUAGE plpgsql AS $$
DECLARE
    v transfer_requests;
BEGIN
    SELECT * INTO v FROM transfer_requests WHERE id = p_transfer FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM fn_fail('MS404', 'TRANSFER_NOT_FOUND', format('Transfer %s not found', p_transfer));
    END IF;
    RETURN v;
END $$;

CREATE FUNCTION fn_is_cross_org(p_transfer transfer_requests) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT s.organization_id <> d.organization_id
    FROM facilities s, facilities d
    WHERE s.id = p_transfer.source_facility_id AND d.id = p_transfer.destination_facility_id
$$;

-- Locks one inventory row (and shares its batch so it cannot be recalled mid-operation).
CREATE FUNCTION fn_lock_inventory(p_inventory bigint)
RETURNS TABLE (inventory_id bigint, facility_id integer, batch_id bigint, medicine_id integer, batch_number text,
               batch_status batch_status, expiry_date date, qty_available integer, qty_reserved integer, qty_damaged integer)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT i.id, i.facility_id, i.batch_id, b.medicine_id, b.batch_number, b.status, b.expiry_date,
           i.qty_available, i.qty_reserved, i.qty_damaged
    FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id
    WHERE i.id = p_inventory
    FOR UPDATE OF i FOR SHARE OF b;
    IF NOT FOUND THEN
        PERFORM fn_fail('MS404', 'INVENTORY_NOT_FOUND', format('Inventory row %s not found', p_inventory));
    END IF;
END $$;

CREATE FUNCTION fn_transfer_summary(p_transfer bigint) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT t.code || ': ' || string_agg(ti.quantity || ' × ' || m.name, ', ' ORDER BY m.name)
           || ' (' || s.code || ' → ' || d.code || ')'
    FROM transfer_requests t
    JOIN transfer_items ti ON ti.transfer_id = t.id
    JOIN medicine_batches b ON b.id = ti.batch_id
    JOIN medicines m ON m.id = b.medicine_id
    JOIN facilities s ON s.id = t.source_facility_id
    JOIN facilities d ON d.id = t.destination_facility_id
    WHERE t.id = p_transfer
    GROUP BY t.code, s.code, d.code
$$;

-- =============================================================================
-- Transfers
-- =============================================================================

-- Request: validates route, authorisation, eligibility and (advisory, unlocked)
-- availability. Does NOT reserve stock — reservation happens at approval.
CREATE FUNCTION fn_create_transfer_request(
    p_actor             bigint,
    p_source            integer,
    p_destination       integer,
    p_items             jsonb,               -- [{"batch_id":1,"quantity":50,"stock_request_item_id":3?}, …]
    p_notes             text   DEFAULT NULL,
    p_recommendation_id bigint DEFAULT NULL,
    p_idempotency_key   uuid   DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload  jsonb := jsonb_build_object('source', p_source, 'destination', p_destination, 'items', p_items,
                                           'notes', p_notes, 'recommendation', p_recommendation_id);
    v_existing text;
    v_src      facilities;
    v_dst      facilities;
    v_cfg      engine_config;
    v_id       bigint;
    v_item     jsonb;
    v_qty      integer;
    v_batch    medicine_batches;
    v_inv      inventory;
    v_med      medicines;
    v_item_id  bigint;
    v_rec      redistribution_recommendations;
    v_req_item stock_request_items;
    v_req      stock_requests;
BEGIN
    v_existing := fn_idem_lookup(p_actor, p_idempotency_key, 'transfer.create', v_payload);
    IF v_existing IS NOT NULL THEN RETURN v_existing::bigint; END IF;

    IF NOT (fn_user_has_permission(p_actor, p_destination, 'transfer:request')
            OR fn_user_has_permission(p_actor, p_source, 'transfer:request')) THEN
        PERFORM fn_fail('MS403', 'FORBIDDEN', 'You can only request transfers into or out of your own facility');
    END IF;

    SELECT * INTO v_src FROM facilities WHERE id = p_source;
    SELECT * INTO v_dst FROM facilities WHERE id = p_destination;
    IF v_src.id IS NULL OR v_dst.id IS NULL THEN
        PERFORM fn_fail('MS404', 'FACILITY_NOT_FOUND', 'Source or destination facility not found');
    END IF;
    IF NOT (v_src.is_active AND v_dst.is_active) THEN
        PERFORM fn_fail('MS422', 'FACILITY_INACTIVE', 'Both facilities must be active');
    END IF;
    IF p_source = p_destination THEN
        PERFORM fn_fail('MS422', 'SAME_FACILITY', 'Source and destination must differ');
    END IF;
    IF NOT fn_is_transfer_authorised(p_source, p_destination) THEN
        PERFORM fn_fail('MS403', 'PARTNER_NOT_AUTHORISED',
            format('%s and %s belong to organisations without an active transfer agreement', v_src.code, v_dst.code));
    END IF;
    IF fn_distance_km(p_source, p_destination) > v_src.max_dispatch_radius_km THEN
        PERFORM fn_fail('MS422', 'OUT_OF_RANGE',
            format('Destination is %s km away; %s dispatches within %s km',
                   fn_distance_km(p_source, p_destination), v_src.code, v_src.max_dispatch_radius_km));
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        PERFORM fn_fail('MS422', 'NO_ITEMS', 'A transfer needs at least one item');
    END IF;

    SELECT * INTO v_cfg FROM engine_config;

    IF p_recommendation_id IS NOT NULL THEN
        SELECT * INTO v_rec FROM redistribution_recommendations WHERE id = p_recommendation_id FOR UPDATE;
        IF NOT FOUND THEN
            PERFORM fn_fail('MS404', 'RECOMMENDATION_NOT_FOUND', 'Recommendation not found');
        END IF;
        IF v_rec.status <> 'OPEN' THEN
            PERFORM fn_fail('MS409', 'RECOMMENDATION_NOT_OPEN', format('Recommendation is %s', v_rec.status));
        END IF;
        IF v_rec.destination_facility_id <> p_destination
           OR (SELECT facility_id FROM inventory WHERE id = v_rec.source_inventory_id) <> p_source THEN
            PERFORM fn_fail('MS422', 'RECOMMENDATION_MISMATCH', 'Transfer route differs from the recommendation');
        END IF;
        UPDATE redistribution_recommendations
           SET status = 'ACCEPTED', status_changed_by = p_actor, status_changed_at = fn_now()
         WHERE id = p_recommendation_id;
    END IF;

    PERFORM fn_set_actor(p_actor);
    PERFORM set_config('medshare.transition_note', coalesce(p_notes, 'Requested'), true);

    INSERT INTO transfer_requests (code, source_facility_id, destination_facility_id, recommendation_id, requested_by, request_notes)
    VALUES ('TRF-' || to_char(fn_today(), 'YYYY') || '-' || lpad(nextval('transfer_code_seq')::text, 5, '0'),
            p_source, p_destination, p_recommendation_id, p_actor, p_notes)
    RETURNING id INTO v_id;
    PERFORM fn_clear_actor();

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        v_qty := (v_item ->> 'quantity')::integer;
        IF v_qty IS NULL OR v_qty <= 0 THEN
            PERFORM fn_fail('MS422', 'INVALID_QUANTITY', 'Item quantities must be positive integers');
        END IF;

        SELECT * INTO v_batch FROM medicine_batches WHERE id = (v_item ->> 'batch_id')::bigint;
        IF NOT FOUND THEN
            PERFORM fn_fail('MS404', 'BATCH_NOT_FOUND', format('Batch %s not found', v_item ->> 'batch_id'));
        END IF;
        SELECT * INTO v_inv FROM inventory WHERE facility_id = p_source AND batch_id = v_batch.id;
        IF NOT FOUND THEN
            PERFORM fn_fail('MS422', 'BATCH_NOT_AT_SOURCE', format('Batch %s is not held by %s', v_batch.batch_number, v_src.code));
        END IF;
        IF v_batch.status <> 'ACTIVE' THEN
            PERFORM fn_fail('MS422', 'BATCH_NOT_ELIGIBLE', format('Batch %s is %s', v_batch.batch_number, v_batch.status));
        END IF;
        IF v_batch.expiry_date < fn_today() + v_cfg.min_remaining_shelf_life_days THEN
            PERFORM fn_fail('MS422', 'BATCH_NOT_ELIGIBLE',
                format('Batch %s expires %s; transfers need at least %s days of remaining shelf life',
                       v_batch.batch_number, v_batch.expiry_date, v_cfg.min_remaining_shelf_life_days));
        END IF;
        IF v_inv.qty_available < v_qty THEN
            PERFORM fn_fail('MS422', 'INSUFFICIENT_STOCK',
                format('Only %s units of batch %s are available at %s', v_inv.qty_available, v_batch.batch_number, v_src.code));
        END IF;
        SELECT * INTO v_med FROM medicines WHERE id = v_batch.medicine_id;
        IF v_med.requires_cold_chain AND NOT (v_src.has_cold_chain AND v_dst.has_cold_chain) THEN
            PERFORM fn_fail('MS422', 'COLD_CHAIN_REQUIRED', format('%s requires cold chain at both facilities', v_med.name));
        END IF;

        INSERT INTO transfer_items (transfer_id, batch_id, quantity) VALUES (v_id, v_batch.id, v_qty)
        RETURNING id INTO v_item_id;

        IF (v_item ->> 'stock_request_item_id') IS NOT NULL THEN
            SELECT * INTO v_req_item FROM stock_request_items WHERE id = (v_item ->> 'stock_request_item_id')::bigint;
            SELECT * INTO v_req FROM stock_requests WHERE id = v_req_item.stock_request_id;
            IF v_req.id IS NULL OR v_req.requesting_facility_id <> p_destination
               OR v_req_item.medicine_id <> v_batch.medicine_id OR v_req.status <> 'OPEN' THEN
                PERFORM fn_fail('MS422', 'REQUEST_MISMATCH', 'Stock request line does not match this transfer item');
            END IF;
            INSERT INTO stock_request_fulfilments (transfer_item_id, stock_request_item_id) VALUES (v_item_id, v_req_item.id);
        END IF;
    END LOOP;

    PERFORM fn_audit(p_actor, 'TRANSFER_REQUESTED', 'TRANSFER', v_id::text, p_destination, NULL,
                     jsonb_build_object('source', p_source, 'destination', p_destination, 'items', p_items));
    PERFORM fn_notify_facility_role(p_source, 'FACILITY_MANAGER', 'TRANSFER', 'Transfer awaiting approval',
                                    fn_transfer_summary(v_id), 'TRANSFER', v_id::text);
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'transfer.create', v_payload, 'TRANSFER', v_id::text);
    RETURN v_id;
END $$;

-- Inventory reservation for every item of a transfer (all-or-nothing).
-- Caller must hold the transfer row lock. Inventory rows are locked in id order.
CREATE PROCEDURE sp_reserve_transfer_inventory(p_transfer bigint, p_actor bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_t        transfer_requests;
    v_cfg      engine_config;
    v_expected integer;
    v_locked   integer := 0;
    r          record;
BEGIN
    SELECT * INTO v_t FROM transfer_requests WHERE id = p_transfer;
    SELECT * INTO v_cfg FROM engine_config;
    SELECT count(*) INTO v_expected FROM transfer_items WHERE transfer_id = p_transfer;

    FOR r IN
        SELECT ti.id AS item_id, ti.quantity, i.id AS inventory_id, i.qty_available,
               b.batch_number, b.status, b.expiry_date
        FROM transfer_items ti
        JOIN inventory i        ON i.facility_id = v_t.source_facility_id AND i.batch_id = ti.batch_id
        JOIN medicine_batches b ON b.id = ti.batch_id
        WHERE ti.transfer_id = p_transfer
        ORDER BY i.id
        FOR UPDATE OF i FOR SHARE OF b               -- row locks: re-reads the latest committed balance
    LOOP
        v_locked := v_locked + 1;
        IF r.status <> 'ACTIVE' THEN
            PERFORM fn_fail('MS422', 'BATCH_NOT_ELIGIBLE', format('Batch %s is %s', r.batch_number, r.status));
        END IF;
        IF r.expiry_date < fn_today() + v_cfg.min_remaining_shelf_life_days THEN
            PERFORM fn_fail('MS422', 'BATCH_NOT_ELIGIBLE', format('Batch %s is expired or too close to expiry (%s)', r.batch_number, r.expiry_date));
        END IF;
        IF r.qty_available < r.quantity THEN
            PERFORM fn_fail('MS422', 'INSUFFICIENT_STOCK',
                format('Only %s units of batch %s are available; %s requested', r.qty_available, r.batch_number, r.quantity));
        END IF;
        INSERT INTO inventory_movements (inventory_id, movement_type, quantity, transfer_item_id, reference, performed_by)
        VALUES (r.inventory_id, 'RESERVE', r.quantity, r.item_id, v_t.code, p_actor);
    END LOOP;

    IF v_locked <> v_expected THEN
        PERFORM fn_fail('MS422', 'BATCH_NOT_AT_SOURCE', 'One or more batches are no longer held by the source facility');
    END IF;
END $$;

-- Approval of one stage. When every required stage is approved, inventory is
-- reserved and the transfer becomes APPROVED — atomically.
CREATE PROCEDURE sp_approve_transfer(
    p_actor           bigint,
    p_transfer        bigint,
    p_stage           approval_stage  DEFAULT 'SOURCE_FACILITY',
    p_comment         text            DEFAULT NULL,
    p_idempotency_key uuid            DEFAULT NULL,
    INOUT p_status    transfer_status DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload  jsonb := jsonb_build_object('transfer', p_transfer, 'stage', p_stage, 'comment', p_comment);
    v_t        transfer_requests;
    v_cross    boolean;
    v_required approval_stage[];
BEGIN
    IF fn_idem_lookup(p_actor, p_idempotency_key, 'transfer.approve', v_payload) IS NOT NULL THEN
        SELECT status INTO p_status FROM transfer_requests WHERE id = p_transfer;
        RETURN;
    END IF;

    v_t := fn_lock_transfer(p_transfer);
    IF v_t.status <> 'PENDING' THEN
        PERFORM fn_fail('MS409', 'INVALID_STATE', format('Transfer %s is %s, not PENDING', v_t.code, v_t.status));
    END IF;

    v_cross := fn_is_cross_org(v_t);
    IF p_stage = 'SOURCE_ORGANIZATION' AND NOT v_cross THEN
        PERFORM fn_fail('MS422', 'STAGE_NOT_REQUIRED', 'Organisation approval is only required for cross-organisation transfers');
    END IF;
    PERFORM fn_require_permission(p_actor, v_t.source_facility_id,
        CASE p_stage WHEN 'SOURCE_FACILITY' THEN 'transfer:approve' ELSE 'transfer:approve_org' END);
    IF p_actor = v_t.requested_by THEN
        PERFORM fn_fail('MS403', 'SELF_APPROVAL', 'A requester cannot approve their own transfer');
    END IF;
    IF EXISTS (SELECT 1 FROM transfer_approvals WHERE transfer_id = p_transfer AND stage = p_stage) THEN
        PERFORM fn_fail('MS409', 'STAGE_ALREADY_DECIDED', format('Stage %s has already been decided', p_stage));
    END IF;
    IF NOT fn_is_transfer_authorised(v_t.source_facility_id, v_t.destination_facility_id) THEN
        PERFORM fn_fail('MS403', 'PARTNER_NOT_AUTHORISED', 'The organisation agreement for this route is no longer in force');
    END IF;

    INSERT INTO transfer_approvals (transfer_id, stage, decision, decided_by, comment)
    VALUES (p_transfer, p_stage, 'APPROVED', p_actor, p_comment);

    v_required := CASE WHEN v_cross THEN ARRAY['SOURCE_FACILITY', 'SOURCE_ORGANIZATION']::approval_stage[]
                       ELSE ARRAY['SOURCE_FACILITY']::approval_stage[] END;

    IF NOT EXISTS (SELECT unnest(v_required)
                   EXCEPT
                   SELECT stage FROM transfer_approvals WHERE transfer_id = p_transfer AND decision = 'APPROVED') THEN
        CALL sp_reserve_transfer_inventory(p_transfer, p_actor);
        PERFORM fn_set_actor(p_actor);
        PERFORM set_config('medshare.transition_note', coalesce(p_comment, 'Approved'), true);
        UPDATE transfer_requests SET status = 'APPROVED' WHERE id = p_transfer;
        PERFORM fn_clear_actor();

        INSERT INTO notifications (recipient_user_id, category, title, body, entity_type, entity_id)
        VALUES (v_t.requested_by, 'TRANSFER', 'Transfer approved', fn_transfer_summary(p_transfer), 'TRANSFER', p_transfer::text);
        PERFORM fn_notify_facility_role(v_t.source_facility_id, 'INVENTORY_MANAGER', 'TRANSFER', 'Transfer ready to dispatch',
                                        fn_transfer_summary(p_transfer), 'TRANSFER', p_transfer::text);
    END IF;

    PERFORM fn_audit(p_actor, 'TRANSFER_APPROVED', 'TRANSFER', p_transfer::text, v_t.source_facility_id,
                     jsonb_build_object('status', v_t.status),
                     jsonb_build_object('stage', p_stage, 'comment', p_comment));
    SELECT status INTO p_status FROM transfer_requests WHERE id = p_transfer;
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'transfer.approve', v_payload, 'TRANSFER', p_transfer::text);
END $$;

CREATE PROCEDURE sp_reject_transfer(
    p_actor           bigint,
    p_transfer        bigint,
    p_reason          text,
    p_stage           approval_stage  DEFAULT 'SOURCE_FACILITY',
    p_idempotency_key uuid            DEFAULT NULL,
    INOUT p_status    transfer_status DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload jsonb := jsonb_build_object('transfer', p_transfer, 'stage', p_stage, 'reason', p_reason);
    v_t       transfer_requests;
BEGIN
    IF fn_idem_lookup(p_actor, p_idempotency_key, 'transfer.reject', v_payload) IS NOT NULL THEN
        SELECT status INTO p_status FROM transfer_requests WHERE id = p_transfer;
        RETURN;
    END IF;

    v_t := fn_lock_transfer(p_transfer);
    IF v_t.status <> 'PENDING' THEN
        PERFORM fn_fail('MS409', 'INVALID_STATE',
            format('Transfer %s is %s; only PENDING transfers can be rejected (cancel an approved one instead)', v_t.code, v_t.status));
    END IF;
    IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
        PERFORM fn_fail('MS422', 'REASON_REQUIRED', 'A rejection reason is required');
    END IF;
    IF p_stage = 'SOURCE_ORGANIZATION' AND NOT fn_is_cross_org(v_t) THEN
        PERFORM fn_fail('MS422', 'STAGE_NOT_REQUIRED', 'Organisation approval is only required for cross-organisation transfers');
    END IF;
    PERFORM fn_require_permission(p_actor, v_t.source_facility_id,
        CASE p_stage WHEN 'SOURCE_FACILITY' THEN 'transfer:approve' ELSE 'transfer:approve_org' END);
    IF EXISTS (SELECT 1 FROM transfer_approvals WHERE transfer_id = p_transfer AND stage = p_stage) THEN
        PERFORM fn_fail('MS409', 'STAGE_ALREADY_DECIDED', format('Stage %s has already been decided', p_stage));
    END IF;

    INSERT INTO transfer_approvals (transfer_id, stage, decision, decided_by, comment)
    VALUES (p_transfer, p_stage, 'REJECTED', p_actor, btrim(p_reason));

    PERFORM fn_set_actor(p_actor);
    PERFORM set_config('medshare.transition_note', btrim(p_reason), true);
    UPDATE transfer_requests SET status = 'REJECTED', rejection_reason = btrim(p_reason) WHERE id = p_transfer;
    PERFORM fn_clear_actor();

    INSERT INTO notifications (recipient_user_id, category, title, body, entity_type, entity_id)
    VALUES (v_t.requested_by, 'TRANSFER', 'Transfer rejected', fn_transfer_summary(p_transfer) || ' — ' || btrim(p_reason),
            'TRANSFER', p_transfer::text);
    PERFORM fn_audit(p_actor, 'TRANSFER_REJECTED', 'TRANSFER', p_transfer::text, v_t.source_facility_id,
                     jsonb_build_object('status', v_t.status), jsonb_build_object('stage', p_stage, 'reason', btrim(p_reason)));
    p_status := 'REJECTED';
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'transfer.reject', v_payload, 'TRANSFER', p_transfer::text);
END $$;

-- Cancel a PENDING or APPROVED transfer; an APPROVED one releases its reservation.
CREATE PROCEDURE sp_cancel_transfer(
    p_actor           bigint,
    p_transfer        bigint,
    p_reason          text,
    p_idempotency_key uuid            DEFAULT NULL,
    INOUT p_status    transfer_status DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload jsonb := jsonb_build_object('transfer', p_transfer, 'reason', p_reason);
    v_t       transfer_requests;
    r         record;
BEGIN
    IF fn_idem_lookup(p_actor, p_idempotency_key, 'transfer.cancel', v_payload) IS NOT NULL THEN
        SELECT status INTO p_status FROM transfer_requests WHERE id = p_transfer;
        RETURN;
    END IF;

    v_t := fn_lock_transfer(p_transfer);
    IF v_t.status NOT IN ('PENDING', 'APPROVED') THEN
        PERFORM fn_fail('MS409', 'INVALID_STATE', format('Transfer %s is %s and can no longer be cancelled', v_t.code, v_t.status));
    END IF;
    IF NOT (p_actor = v_t.requested_by
            OR fn_user_has_permission(p_actor, v_t.destination_facility_id, 'transfer:request')
            OR fn_user_has_permission(p_actor, v_t.source_facility_id, 'transfer:approve')) THEN
        PERFORM fn_fail('MS403', 'FORBIDDEN', 'Only the requester, destination staff or the source facility manager can cancel');
    END IF;
    IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
        PERFORM fn_fail('MS422', 'REASON_REQUIRED', 'A cancellation reason is required');
    END IF;

    IF v_t.status = 'APPROVED' THEN
        FOR r IN
            SELECT ti.id AS item_id, ti.quantity, i.id AS inventory_id
            FROM transfer_items ti
            JOIN inventory i ON i.facility_id = v_t.source_facility_id AND i.batch_id = ti.batch_id
            WHERE ti.transfer_id = p_transfer
            ORDER BY i.id
            FOR UPDATE OF i
        LOOP
            INSERT INTO inventory_movements (inventory_id, movement_type, quantity, transfer_item_id, reference, reason, performed_by)
            VALUES (r.inventory_id, 'RELEASE', r.quantity, r.item_id, v_t.code, btrim(p_reason), p_actor);
        END LOOP;
    END IF;

    PERFORM fn_set_actor(p_actor);
    PERFORM set_config('medshare.transition_note', btrim(p_reason), true);
    UPDATE transfer_requests SET status = 'CANCELLED' WHERE id = p_transfer;
    PERFORM fn_clear_actor();

    PERFORM fn_audit(p_actor, 'TRANSFER_CANCELLED', 'TRANSFER', p_transfer::text, v_t.destination_facility_id,
                     jsonb_build_object('status', v_t.status), jsonb_build_object('reason', btrim(p_reason)));
    p_status := 'CANCELLED';
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'transfer.cancel', v_payload, 'TRANSFER', p_transfer::text);
END $$;

-- Dispatch: reserved → out of the source. Refuses batches recalled / expired since approval.
CREATE PROCEDURE sp_dispatch_transfer(
    p_actor           bigint,
    p_transfer        bigint,
    p_note            text            DEFAULT NULL,
    p_idempotency_key uuid            DEFAULT NULL,
    INOUT p_status    transfer_status DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload jsonb := jsonb_build_object('transfer', p_transfer, 'note', p_note);
    v_t       transfer_requests;
    r         record;
BEGIN
    IF fn_idem_lookup(p_actor, p_idempotency_key, 'transfer.dispatch', v_payload) IS NOT NULL THEN
        SELECT status INTO p_status FROM transfer_requests WHERE id = p_transfer;
        RETURN;
    END IF;

    v_t := fn_lock_transfer(p_transfer);
    IF v_t.status <> 'APPROVED' THEN
        PERFORM fn_fail('MS409', 'INVALID_STATE', format('Transfer %s is %s, not APPROVED', v_t.code, v_t.status));
    END IF;
    PERFORM fn_require_permission(p_actor, v_t.source_facility_id, 'transfer:dispatch');

    FOR r IN
        SELECT ti.id AS item_id, ti.quantity, i.id AS inventory_id, i.qty_reserved, b.batch_number, b.status, b.expiry_date
        FROM transfer_items ti
        JOIN inventory i        ON i.facility_id = v_t.source_facility_id AND i.batch_id = ti.batch_id
        JOIN medicine_batches b ON b.id = ti.batch_id
        WHERE ti.transfer_id = p_transfer
        ORDER BY i.id
        FOR UPDATE OF i FOR SHARE OF b
    LOOP
        IF r.status <> 'ACTIVE' THEN
            PERFORM fn_fail('MS409', 'BATCH_' || r.status::text,
                format('Batch %s was %s after approval; cancel this transfer to release the stock', r.batch_number, r.status));
        END IF;
        IF r.expiry_date < fn_today() THEN
            PERFORM fn_fail('MS422', 'BATCH_EXPIRED', format('Batch %s expired on %s', r.batch_number, r.expiry_date));
        END IF;
        IF r.qty_reserved < r.quantity THEN
            PERFORM fn_fail('MS409', 'RESERVATION_MISSING', format('Reservation for batch %s is incomplete', r.batch_number));
        END IF;
        INSERT INTO inventory_movements (inventory_id, movement_type, quantity, transfer_item_id, reference, reason, performed_by)
        VALUES (r.inventory_id, 'TRANSFER_OUT', r.quantity, r.item_id, v_t.code, p_note, p_actor);
    END LOOP;

    PERFORM fn_set_actor(p_actor);
    PERFORM set_config('medshare.transition_note', coalesce(p_note, 'Dispatched'), true);
    UPDATE transfer_requests SET status = 'DISPATCHED' WHERE id = p_transfer;
    PERFORM fn_clear_actor();

    PERFORM fn_notify_facility_role(v_t.destination_facility_id, 'INVENTORY_MANAGER', 'TRANSFER', 'Transfer in transit',
                                    fn_transfer_summary(p_transfer), 'TRANSFER', p_transfer::text);
    PERFORM fn_audit(p_actor, 'TRANSFER_DISPATCHED', 'TRANSFER', p_transfer::text, v_t.source_facility_id,
                     jsonb_build_object('status', v_t.status), jsonb_build_object('note', p_note));
    p_status := 'DISPATCHED';
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'transfer.dispatch', v_payload, 'TRANSFER', p_transfer::text);
END $$;

-- Receipt: adds stock at the destination (received → available, damaged → damaged).
-- p_lines: NULL = everything received intact, or [{"item_id":1,"received":48,"damaged":2}, …] covering every item.
CREATE PROCEDURE sp_receive_transfer(
    p_actor           bigint,
    p_transfer        bigint,
    p_lines           jsonb           DEFAULT NULL,
    p_note            text            DEFAULT NULL,
    p_idempotency_key uuid            DEFAULT NULL,
    INOUT p_status    transfer_status DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload jsonb := jsonb_build_object('transfer', p_transfer, 'lines', p_lines, 'note', p_note);
    v_t       transfer_requests;
    v_line    jsonb;
    v_recv    integer;
    v_dmg     integer;
    r         record;
BEGIN
    IF fn_idem_lookup(p_actor, p_idempotency_key, 'transfer.receive', v_payload) IS NOT NULL THEN
        SELECT status INTO p_status FROM transfer_requests WHERE id = p_transfer;
        RETURN;
    END IF;

    v_t := fn_lock_transfer(p_transfer);
    IF v_t.status <> 'DISPATCHED' THEN
        PERFORM fn_fail('MS409', 'INVALID_STATE', format('Transfer %s is %s, not DISPATCHED', v_t.code, v_t.status));
    END IF;
    PERFORM fn_require_permission(p_actor, v_t.destination_facility_id, 'transfer:receive');

    IF p_lines IS NOT NULL THEN
        IF jsonb_typeof(p_lines) <> 'array'
           OR (SELECT count(DISTINCT (l ->> 'item_id')::bigint) FROM jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines)
           OR EXISTS (SELECT 1 FROM transfer_items ti WHERE ti.transfer_id = p_transfer
                      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE (l ->> 'item_id')::bigint = ti.id))
           OR jsonb_array_length(p_lines) <> (SELECT count(*) FROM transfer_items WHERE transfer_id = p_transfer) THEN
            PERFORM fn_fail('MS422', 'RECEIPT_MISMATCH', 'Receipt lines must list every transfer item exactly once');
        END IF;
    END IF;

    -- Destination may not hold this batch yet: create empty rows (race-safe).
    INSERT INTO inventory (facility_id, batch_id)
    SELECT v_t.destination_facility_id, ti.batch_id FROM transfer_items ti WHERE ti.transfer_id = p_transfer
    ON CONFLICT ON CONSTRAINT uq_inventory_facility_batch DO NOTHING;

    FOR r IN
        SELECT ti.id AS item_id, ti.quantity, i.id AS inventory_id
        FROM transfer_items ti
        JOIN inventory i ON i.facility_id = v_t.destination_facility_id AND i.batch_id = ti.batch_id
        WHERE ti.transfer_id = p_transfer
        ORDER BY i.id
        FOR UPDATE OF i
    LOOP
        IF p_lines IS NULL THEN
            v_recv := r.quantity; v_dmg := 0;
        ELSE
            SELECT l INTO v_line FROM jsonb_array_elements(p_lines) l WHERE (l ->> 'item_id')::bigint = r.item_id;
            v_recv := coalesce((v_line ->> 'received')::integer, 0);
            v_dmg  := coalesce((v_line ->> 'damaged')::integer, 0);
        END IF;
        IF v_recv < 0 OR v_dmg < 0 OR v_recv + v_dmg <> r.quantity THEN
            PERFORM fn_fail('MS422', 'RECEIPT_MISMATCH',
                format('Item %s: received (%s) + damaged (%s) must equal dispatched (%s)', r.item_id, v_recv, v_dmg, r.quantity));
        END IF;

        UPDATE transfer_items SET quantity_received = v_recv, quantity_damaged_in_transit = v_dmg WHERE id = r.item_id;
        IF v_recv > 0 THEN
            INSERT INTO inventory_movements (inventory_id, movement_type, quantity, transfer_item_id, reference, performed_by)
            VALUES (r.inventory_id, 'TRANSFER_IN', v_recv, r.item_id, v_t.code, p_actor);
        END IF;
        IF v_dmg > 0 THEN
            INSERT INTO inventory_movements (inventory_id, movement_type, quantity, transfer_item_id, reference, reason, performed_by)
            VALUES (r.inventory_id, 'TRANSIT_DAMAGE', v_dmg, r.item_id, v_t.code, coalesce(p_note, 'Damaged in transit'), p_actor);
        END IF;
    END LOOP;

    PERFORM fn_set_actor(p_actor);
    PERFORM set_config('medshare.transition_note', coalesce(p_note, 'Received'), true);
    UPDATE transfer_requests SET status = 'RECEIVED' WHERE id = p_transfer;
    PERFORM fn_clear_actor();

    -- Close stock requests whose every line is now fully received (correlated subquery).
    UPDATE stock_requests sr
       SET status = 'CLOSED', closed_at = fn_now()
     WHERE sr.status = 'OPEN'
       AND sr.id IN (SELECT sri.stock_request_id
                     FROM stock_request_fulfilments f
                     JOIN stock_request_items sri ON sri.id = f.stock_request_item_id
                     JOIN transfer_items ti ON ti.id = f.transfer_item_id
                     WHERE ti.transfer_id = p_transfer)
       AND NOT EXISTS (
            SELECT 1 FROM stock_request_items x
            WHERE x.stock_request_id = sr.id
              AND x.quantity_requested > (SELECT coalesce(sum(ti2.quantity_received), 0)
                                          FROM stock_request_fulfilments f2
                                          JOIN transfer_items ti2 ON ti2.id = f2.transfer_item_id
                                          WHERE f2.stock_request_item_id = x.id));

    PERFORM fn_notify_facility_role(v_t.source_facility_id, 'FACILITY_MANAGER', 'TRANSFER', 'Transfer received',
                                    fn_transfer_summary(p_transfer), 'TRANSFER', p_transfer::text);
    PERFORM fn_audit(p_actor, 'TRANSFER_RECEIVED', 'TRANSFER', p_transfer::text, v_t.destination_facility_id,
                     jsonb_build_object('status', v_t.status), jsonb_build_object('lines', p_lines, 'note', p_note));
    p_status := 'RECEIVED';
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'transfer.receive', v_payload, 'TRANSFER', p_transfer::text);
END $$;

-- =============================================================================
-- Ledger entry points (non-transfer stock changes)
-- =============================================================================

-- Goods receipt from a supplier. Creates the batch on first sight, else checks it matches.
CREATE PROCEDURE sp_receive_stock(
    p_actor             bigint,
    p_facility          integer,
    p_medicine          integer,
    p_manufacturer      integer,
    p_batch_number      text,
    p_manufacture_date  date,
    p_expiry_date       date,
    p_unit_cost         numeric,
    p_quantity          integer,
    p_reference         text   DEFAULT NULL,
    p_idempotency_key   uuid   DEFAULT NULL,
    INOUT p_inventory_id bigint DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_payload jsonb := jsonb_build_object('facility', p_facility, 'medicine', p_medicine, 'manufacturer', p_manufacturer,
                                          'batch', upper(btrim(p_batch_number)), 'mfg', p_manufacture_date, 'exp', p_expiry_date,
                                          'cost', p_unit_cost, 'qty', p_quantity, 'ref', p_reference);
    v_existing text;
    v_batch    medicine_batches;
    v_number   text := upper(btrim(p_batch_number));
BEGIN
    v_existing := fn_idem_lookup(p_actor, p_idempotency_key, 'stock.receive', v_payload);
    IF v_existing IS NOT NULL THEN p_inventory_id := v_existing::bigint; RETURN; END IF;

    PERFORM fn_require_permission(p_actor, p_facility, 'inventory:write');
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        PERFORM fn_fail('MS422', 'INVALID_QUANTITY', 'Quantity must be a positive integer');
    END IF;
    IF p_expiry_date <= fn_today() THEN
        PERFORM fn_fail('MS422', 'BATCH_EXPIRED', 'Cannot receive an expired batch');
    END IF;
    IF p_manufacture_date > fn_today() THEN
        PERFORM fn_fail('MS422', 'INVALID_DATE', 'Manufacture date cannot be in the future');
    END IF;

    INSERT INTO medicine_batches (medicine_id, manufacturer_id, batch_number, manufacture_date, expiry_date, unit_cost)
    VALUES (p_medicine, p_manufacturer, v_number, p_manufacture_date, p_expiry_date, p_unit_cost)
    ON CONFLICT ON CONSTRAINT uq_batch_lot DO NOTHING;

    SELECT * INTO v_batch FROM medicine_batches
    WHERE manufacturer_id = p_manufacturer AND medicine_id = p_medicine AND batch_number = v_number;
    IF v_batch.manufacture_date <> p_manufacture_date OR v_batch.expiry_date <> p_expiry_date OR v_batch.unit_cost <> p_unit_cost THEN
        PERFORM fn_fail('MS422', 'BATCH_MISMATCH', format('Batch %s already exists with different dates or cost', v_number));
    END IF;
    IF v_batch.status <> 'ACTIVE' THEN
        PERFORM fn_fail('MS422', 'BATCH_NOT_ELIGIBLE', format('Batch %s is %s', v_number, v_batch.status));
    END IF;

    INSERT INTO inventory (facility_id, batch_id) VALUES (p_facility, v_batch.id)
    ON CONFLICT ON CONSTRAINT uq_inventory_facility_batch DO NOTHING;
    SELECT inventory_id INTO p_inventory_id FROM fn_lock_inventory(
        (SELECT id FROM inventory WHERE facility_id = p_facility AND batch_id = v_batch.id));

    INSERT INTO inventory_movements (inventory_id, movement_type, quantity, reference, performed_by)
    VALUES (p_inventory_id, 'RECEIPT', p_quantity, p_reference, p_actor);

    PERFORM fn_audit(p_actor, 'STOCK_RECEIVED', 'INVENTORY', p_inventory_id::text, p_facility, NULL,
                     jsonb_build_object('batch_id', v_batch.id, 'batch_number', v_number, 'quantity', p_quantity, 'reference', p_reference));
    PERFORM fn_idem_record(p_actor, p_idempotency_key, 'stock.receive', v_payload, 'INVENTORY', p_inventory_id::text);
END $$;

-- Shared implementation for single-row ledger operations.
CREATE FUNCTION fn_ledger_entry(p_actor bigint, p_inventory bigint, p_type text, p_quantity integer,
                                p_reason text, p_reference text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    v   record;
    v_id bigint;
BEGIN
    SELECT * INTO v FROM fn_lock_inventory(p_inventory);
    PERFORM fn_require_permission(p_actor, v.facility_id, 'inventory:write');
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        PERFORM fn_fail('MS422', 'INVALID_QUANTITY', 'Quantity must be a positive integer');
    END IF;

    IF p_type = 'DISPENSE' AND (v.batch_status <> 'ACTIVE' OR v.expiry_date < fn_today()) THEN
        PERFORM fn_fail('MS422', 'BATCH_NOT_ELIGIBLE',
            format('Batch %s cannot be dispensed (%s)', v.batch_number,
                   CASE WHEN v.batch_status <> 'ACTIVE' THEN v.batch_status::text ELSE 'expired ' || v.expiry_date END));
    END IF;
    IF p_type = 'EXPIRY_WRITE_OFF' AND v.expiry_date >= fn_today() THEN
        PERFORM fn_fail('MS422', 'BATCH_NOT_EXPIRED', format('Batch %s expires %s and is not yet expired', v.batch_number, v.expiry_date));
    END IF;
    IF p_type IN ('DISPENSE', 'DAMAGE', 'EXPIRY_WRITE_OFF', 'ADJUSTMENT_OUT') AND v.qty_available < p_quantity THEN
        PERFORM fn_fail('MS422', 'INSUFFICIENT_STOCK',
            format('Only %s units of batch %s are available', v.qty_available, v.batch_number));
    END IF;
    IF p_type = 'DISPOSAL' AND v.qty_damaged < p_quantity THEN
        PERFORM fn_fail('MS422', 'INSUFFICIENT_STOCK', format('Only %s damaged units of batch %s', v.qty_damaged, v.batch_number));
    END IF;

    INSERT INTO inventory_movements (inventory_id, movement_type, quantity, reason, reference, performed_by)
    VALUES (p_inventory, p_type, p_quantity, p_reason, p_reference, p_actor)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION fn_record_dispense(p_actor bigint, p_inventory bigint, p_quantity integer, p_reference text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT fn_ledger_entry(p_actor, p_inventory, 'DISPENSE', p_quantity, NULL, p_reference)
$$;

CREATE FUNCTION fn_record_damage(p_actor bigint, p_inventory bigint, p_quantity integer, p_reason text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT fn_ledger_entry(p_actor, p_inventory, 'DAMAGE', p_quantity, p_reason, NULL)
$$;

CREATE FUNCTION fn_dispose_damaged(p_actor bigint, p_inventory bigint, p_quantity integer, p_reason text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT fn_ledger_entry(p_actor, p_inventory, 'DISPOSAL', p_quantity, p_reason, NULL)
$$;

CREATE FUNCTION fn_write_off_expired(p_actor bigint, p_inventory bigint, p_quantity integer, p_reason text DEFAULT 'Expired stock written off')
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT fn_ledger_entry(p_actor, p_inventory, 'EXPIRY_WRITE_OFF', p_quantity, p_reason, NULL)
$$;

-- Stock-count correction: positive delta increases, negative decreases.
CREATE FUNCTION fn_adjust_stock(p_actor bigint, p_inventory bigint, p_delta integer, p_reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_delta IS NULL OR p_delta = 0 THEN
        PERFORM fn_fail('MS422', 'INVALID_QUANTITY', 'Adjustment delta must be non-zero');
    END IF;
    RETURN fn_ledger_entry(p_actor, p_inventory, CASE WHEN p_delta > 0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END,
                           abs(p_delta), p_reason, NULL);
END $$;

-- Quarantine / recall / re-activate a batch network-wide (platform permission).
CREATE FUNCTION fn_set_batch_status(p_actor bigint, p_batch bigint, p_status batch_status, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_batch medicine_batches;
    f       integer;
BEGIN
    PERFORM fn_require_permission(p_actor, NULL, 'batch:manage');
    SELECT * INTO v_batch FROM medicine_batches WHERE id = p_batch FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM fn_fail('MS404', 'BATCH_NOT_FOUND', format('Batch %s not found', p_batch));
    END IF;
    IF p_status <> 'ACTIVE' AND coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
        PERFORM fn_fail('MS422', 'REASON_REQUIRED', 'A reason is required to quarantine or recall a batch');
    END IF;
    PERFORM fn_set_actor(p_actor);
    UPDATE medicine_batches SET status = p_status, status_reason = CASE WHEN p_status = 'ACTIVE' THEN NULL ELSE btrim(p_reason) END
    WHERE id = p_batch;
    PERFORM fn_clear_actor();
    FOR f IN SELECT facility_id FROM inventory WHERE batch_id = p_batch AND qty_available + qty_reserved > 0 LOOP
        PERFORM fn_notify_facility_role(f, 'FACILITY_MANAGER', 'SYSTEM', format('Batch %s %s', v_batch.batch_number, lower(p_status::text)),
                                        coalesce(btrim(p_reason), 'Batch re-activated'), 'BATCH', p_batch::text);
    END LOOP;
END $$;

-- =============================================================================
-- Stock requests & recommendations
-- =============================================================================
CREATE FUNCTION fn_create_stock_request(p_actor bigint, p_facility integer, p_items jsonb,
                                        p_priority request_priority DEFAULT 'ROUTINE', p_needed_by date DEFAULT NULL,
                                        p_notes text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM fn_require_permission(p_actor, p_facility, 'request:create');
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        PERFORM fn_fail('MS422', 'NO_ITEMS', 'A stock request needs at least one line');
    END IF;
    IF p_needed_by IS NOT NULL AND p_needed_by < fn_today() THEN
        PERFORM fn_fail('MS422', 'INVALID_DATE', 'Needed-by date is in the past');
    END IF;
    INSERT INTO stock_requests (code, requesting_facility_id, requested_by, priority, needed_by, notes)
    VALUES ('SR-' || to_char(fn_today(), 'YYYY') || '-' || lpad(nextval('stock_request_code_seq')::text, 5, '0'),
            p_facility, p_actor, p_priority, p_needed_by, p_notes)
    RETURNING id INTO v_id;
    INSERT INTO stock_request_items (stock_request_id, medicine_id, quantity_requested)
    SELECT v_id, (l ->> 'medicine_id')::integer, (l ->> 'quantity')::integer FROM jsonb_array_elements(p_items) l;
    PERFORM fn_audit(p_actor, 'STOCK_REQUEST_CREATED', 'STOCK_REQUEST', v_id::text, p_facility, NULL, jsonb_build_object('items', p_items));
    RETURN v_id;
END $$;

CREATE FUNCTION fn_cancel_stock_request(p_actor bigint, p_request bigint, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v stock_requests;
BEGIN
    SELECT * INTO v FROM stock_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND THEN PERFORM fn_fail('MS404', 'REQUEST_NOT_FOUND', 'Stock request not found'); END IF;
    PERFORM fn_require_permission(p_actor, v.requesting_facility_id, 'request:create');
    IF v.status <> 'OPEN' THEN PERFORM fn_fail('MS409', 'INVALID_STATE', format('Request is %s', v.status)); END IF;
    UPDATE stock_requests SET status = 'CANCELLED', closed_at = fn_now(), notes = concat_ws(E'\n', notes, 'Cancelled: ' || p_reason)
    WHERE id = p_request;
    PERFORM fn_audit(p_actor, 'STOCK_REQUEST_CANCELLED', 'STOCK_REQUEST', p_request::text, v.requesting_facility_id, NULL,
                     jsonb_build_object('reason', p_reason));
END $$;

CREATE FUNCTION fn_dismiss_recommendation(p_actor bigint, p_recommendation bigint, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v   redistribution_recommendations;
    v_src integer;
BEGIN
    SELECT * INTO v FROM redistribution_recommendations WHERE id = p_recommendation FOR UPDATE;
    IF NOT FOUND THEN PERFORM fn_fail('MS404', 'RECOMMENDATION_NOT_FOUND', 'Recommendation not found'); END IF;
    SELECT facility_id INTO v_src FROM inventory WHERE id = v.source_inventory_id;
    IF NOT (fn_user_has_permission(p_actor, v.destination_facility_id, 'recommendation:manage')
            OR fn_user_has_permission(p_actor, v_src, 'recommendation:manage')) THEN
        PERFORM fn_fail('MS403', 'FORBIDDEN', 'Not permitted to dismiss this recommendation');
    END IF;
    IF v.status <> 'OPEN' THEN PERFORM fn_fail('MS409', 'RECOMMENDATION_NOT_OPEN', format('Recommendation is %s', v.status)); END IF;
    UPDATE redistribution_recommendations SET status = 'DISMISSED', status_changed_by = p_actor, status_changed_at = fn_now()
    WHERE id = p_recommendation;
    PERFORM fn_audit(p_actor, 'RECOMMENDATION_DISMISSED', 'RECOMMENDATION', p_recommendation::text, v.destination_facility_id,
                     NULL, jsonb_build_object('reason', p_reason));
END $$;

-- =============================================================================
-- Reconciliation
-- =============================================================================

-- Every discrepancy between balances and the ledger / open transfers.
-- Run at REPEATABLE READ so all checks see one snapshot. Zero rows = consistent.
CREATE FUNCTION fn_reconcile_inventory(p_facility integer DEFAULT NULL)
RETURNS TABLE (check_name text, inventory_id bigint, facility_id integer, batch_id bigint, expected bigint, actual bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH ledger AS (
        SELECT mv.inventory_id,
               sum(mv.quantity * t.effect_available) AS available,
               sum(mv.quantity * t.effect_reserved)  AS reserved,
               sum(mv.quantity * t.effect_damaged)   AS damaged
        FROM inventory_movements mv JOIN movement_types t ON t.code = mv.movement_type
        GROUP BY mv.inventory_id
    ), scoped AS (
        SELECT i.*, coalesce(l.available, 0) AS l_available, coalesce(l.reserved, 0) AS l_reserved, coalesce(l.damaged, 0) AS l_damaged
        FROM inventory i LEFT JOIN ledger l ON l.inventory_id = i.id
        WHERE p_facility IS NULL OR i.facility_id = p_facility
    ), open_reservations AS (
        SELECT t.source_facility_id AS facility_id, ti.batch_id, sum(ti.quantity) AS reserved
        FROM transfer_requests t JOIN transfer_items ti ON ti.transfer_id = t.id
        WHERE t.status = 'APPROVED'
        GROUP BY 1, 2
    )
    SELECT 'LEDGER_AVAILABLE', id, facility_id, batch_id, l_available, qty_available::bigint FROM scoped WHERE l_available <> qty_available
    UNION ALL
    SELECT 'LEDGER_RESERVED',  id, facility_id, batch_id, l_reserved,  qty_reserved::bigint  FROM scoped WHERE l_reserved  <> qty_reserved
    UNION ALL
    SELECT 'LEDGER_DAMAGED',   id, facility_id, batch_id, l_damaged,   qty_damaged::bigint   FROM scoped WHERE l_damaged   <> qty_damaged
    UNION ALL
    SELECT 'OPEN_RESERVATIONS', s.id, s.facility_id, s.batch_id, coalesce(o.reserved, 0), s.qty_reserved::bigint
    FROM scoped s LEFT JOIN open_reservations o ON o.facility_id = s.facility_id AND o.batch_id = s.batch_id
    WHERE coalesce(o.reserved, 0) <> s.qty_reserved
    UNION ALL
    SELECT 'RECEIPT_LEDGER', NULL, t.destination_facility_id, ti.batch_id, ti.quantity_received::bigint,
           coalesce((SELECT sum(mv.quantity) FROM inventory_movements mv
                     WHERE mv.transfer_item_id = ti.id AND mv.movement_type = 'TRANSFER_IN'), 0)
    FROM transfer_requests t JOIN transfer_items ti ON ti.transfer_id = t.id
    WHERE t.status = 'RECEIVED' AND (p_facility IS NULL OR t.destination_facility_id = p_facility)
      AND ti.quantity_received <> coalesce((SELECT sum(mv.quantity) FROM inventory_movements mv
                                            WHERE mv.transfer_item_id = ti.id AND mv.movement_type = 'TRANSFER_IN'), 0)
$$;

CREATE PROCEDURE sp_reconcile_inventory(p_actor bigint, p_facility integer DEFAULT NULL, INOUT p_discrepancies integer DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF p_actor IS NOT NULL THEN
        PERFORM fn_require_permission(p_actor, p_facility, 'report:read');
    END IF;
    SELECT count(*) INTO p_discrepancies FROM fn_reconcile_inventory(p_facility);
    PERFORM fn_audit(p_actor, 'RECONCILIATION_RUN', 'INVENTORY', NULL, p_facility, NULL,
                     jsonb_build_object('discrepancies', p_discrepancies));
END $$;

-- =============================================================================
-- Scheduled jobs (time-driven, therefore functions — not triggers)
-- =============================================================================

-- Expiry alerts: one unresolved alert per (inventory, current level).
CREATE FUNCTION fn_generate_expiry_alerts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_new integer := 0;
    r     record;
BEGIN
    DROP TABLE IF EXISTS _expiry_levels;
    CREATE TEMP TABLE _expiry_levels ON COMMIT DROP AS
    SELECT i.id AS inventory_id, i.facility_id, i.qty_available + i.qty_reserved AS on_hand,
           CASE WHEN b.expiry_date <  fn_today()      THEN 'EXPIRED'
                WHEN b.expiry_date <= fn_today() + 7  THEN 'WITHIN_7_DAYS'
                WHEN b.expiry_date <= fn_today() + 30 THEN 'WITHIN_30_DAYS'
                WHEN b.expiry_date <= fn_today() + 60 THEN 'WITHIN_60_DAYS'
           END::expiry_level AS level
    FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id
    WHERE i.qty_available + i.qty_reserved > 0;

    UPDATE expiry_alerts a SET status = 'RESOLVED', resolved_at = fn_now()
    WHERE a.status <> 'RESOLVED'
      AND NOT EXISTS (SELECT 1 FROM _expiry_levels l WHERE l.inventory_id = a.inventory_id AND l.level = a.level);

    FOR r IN
        INSERT INTO expiry_alerts (inventory_id, level, quantity_at_detection)
        SELECT inventory_id, level, on_hand FROM _expiry_levels WHERE level IS NOT NULL
        ON CONFLICT (inventory_id, level) WHERE status <> 'RESOLVED' DO NOTHING
        RETURNING inventory_id, level
    LOOP
        v_new := v_new + 1;
        IF r.level IN ('EXPIRED', 'WITHIN_7_DAYS') THEN
            PERFORM fn_notify_facility_role(
                (SELECT facility_id FROM inventory WHERE id = r.inventory_id), 'FACILITY_MANAGER', 'EXPIRY',
                CASE r.level WHEN 'EXPIRED' THEN 'Expired stock on hand' ELSE 'Stock expiring within 7 days' END,
                (SELECT m.name || ', batch ' || b.batch_number || ' (expires ' || b.expiry_date || ')'
                 FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id JOIN medicines m ON m.id = b.medicine_id
                 WHERE i.id = r.inventory_id),
                'INVENTORY', r.inventory_id::text);
        END IF;
    END LOOP;
    RETURN v_new;
END $$;

-- Full re-evaluation of shortages (usable stock changes as batches expire).
CREATE FUNCTION fn_refresh_shortage_alerts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    s record;
BEGIN
    FOR s IN SELECT facility_id, medicine_id FROM facility_medicine_settings LOOP
        PERFORM fn_evaluate_shortage(s.facility_id, s.medicine_id);
    END LOOP;
    RETURN (SELECT count(*) FROM shortage_alerts WHERE status <> 'RESOLVED');
END $$;

-- =============================================================================
-- Redistribution engine (design §10). Advisory only: never creates transfers.
-- Call at REPEATABLE READ for a consistent snapshot.
-- =============================================================================
CREATE FUNCTION fn_generate_recommendations(p_actor bigint DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    cfg       engine_config;
    n         record;
    c         record;
    rb        record;
    d         record;
    v_left    integer;
    v_q       integer;
    v_cap     integer;
    v_blft    integer;
    v_slft    integer;
    v_score   numeric;
    v_count   integer := 0;
    v_key     text;
    v_used    numeric;
    v_cons    integer;
    v_excess  integer;
BEGIN
    IF p_actor IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = p_actor AND rp.permission_code = 'recommendation:manage') THEN
        PERFORM fn_fail('MS403', 'FORBIDDEN', 'Generating network recommendations requires an organisation or platform role');
    END IF;
    SELECT * INTO cfg FROM engine_config;

    UPDATE redistribution_recommendations
       SET status = 'SUPERSEDED', status_changed_by = p_actor, status_changed_at = fn_now()
     WHERE status = 'OPEN';

    DROP TABLE IF EXISTS _eng_pair, _eng_need, _eng_surplus, _eng_batch;

    -- (facility, medicine): usable stock + policy + demand (measured or estimated)
    CREATE TEMP TABLE _eng_pair ON COMMIT DROP AS
    WITH usable AS (
        SELECT i.facility_id, b.medicine_id, sum(i.qty_available)::integer AS usable
        FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id
        WHERE b.status = 'ACTIVE' AND b.expiry_date >= fn_today()
        GROUP BY 1, 2
    )
    SELECT coalesce(s.facility_id, u.facility_id) AS facility_id,
           coalesce(s.medicine_id, u.medicine_id) AS medicine_id,
           coalesce(u.usable, 0) AS usable,
           s.min_stock_level, s.reorder_threshold, s.safety_stock,
           coalesce(dm.daily_rate, 0) AS daily_rate,
           coalesce(dm.demand_basis, 'NONE') AS demand_basis
    FROM facility_medicine_settings s
    FULL JOIN usable u ON u.facility_id = s.facility_id AND u.medicine_id = s.medicine_id
    LEFT JOIN v_demand dm ON dm.facility_id = s.facility_id AND dm.medicine_id = s.medicine_id
    JOIN facilities f ON f.id = coalesce(s.facility_id, u.facility_id) AND f.is_active;

    CREATE TEMP TABLE _eng_need ON COMMIT DROP AS
    SELECT facility_id, medicine_id, usable, (reorder_threshold - usable) AS deficit,
           usable < min_stock_level AS critical, daily_rate, demand_basis,
           CASE WHEN daily_rate > 0 THEN usable / daily_rate END AS cover_days
    FROM _eng_pair
    WHERE reorder_threshold IS NOT NULL AND usable < reorder_threshold;

    -- Surplus = usable − (safety stock + demand over the planning horizon)
    CREATE TEMP TABLE _eng_surplus ON COMMIT DROP AS
    SELECT p.facility_id, p.medicine_id,
           greatest(0, p.usable - coalesce(p.safety_stock + ceil(p.daily_rate * e.planning_horizon_days), 0))::integer AS remaining
    FROM _eng_pair p CROSS JOIN engine_config e;

    -- Transfer-eligible source batches (ACTIVE, enough shelf life, stock available)
    CREATE TEMP TABLE _eng_batch ON COMMIT DROP AS
    SELECT i.id AS inventory_id, i.facility_id, b.medicine_id, b.batch_number, b.expiry_date, i.qty_available AS remaining
    FROM inventory i
    JOIN medicine_batches b ON b.id = i.batch_id
    JOIN facilities f ON f.id = i.facility_id AND f.is_active
    CROSS JOIN engine_config e
    WHERE b.status = 'ACTIVE' AND i.qty_available > 0
      AND b.expiry_date >= fn_today() + e.min_remaining_shelf_life_days;

    -- ---------------- Phase A: cover shortages (FEFO, then nearest) ----------------
    FOR n IN SELECT * FROM _eng_need ORDER BY critical DESC, cover_days ASC NULLS LAST, deficit DESC LOOP
        v_left := n.deficit;
        FOR c IN
            SELECT bt.inventory_id, bt.facility_id, bt.batch_number, bt.expiry_date,
                   fn_distance_km(bt.facility_id, n.facility_id) AS dist,
                   (bt.expiry_date - fn_today()) AS days,
                   src.name AS src_name
            FROM _eng_batch bt
            JOIN facilities src ON src.id = bt.facility_id
            JOIN facilities dst ON dst.id = n.facility_id
            JOIN medicines m    ON m.id = bt.medicine_id
            WHERE bt.medicine_id = n.medicine_id
              AND bt.facility_id <> n.facility_id
              AND fn_is_transfer_authorised(bt.facility_id, n.facility_id)
              AND (NOT m.requires_cold_chain OR (src.has_cold_chain AND dst.has_cold_chain))
              AND fn_distance_km(bt.facility_id, n.facility_id) <= src.max_dispatch_radius_km
            ORDER BY bt.expiry_date, dist
        LOOP
            EXIT WHEN v_left <= 0;
            SELECT remaining INTO v_blft FROM _eng_batch WHERE inventory_id = c.inventory_id;
            SELECT remaining INTO v_slft FROM _eng_surplus WHERE facility_id = c.facility_id AND medicine_id = n.medicine_id;
            -- never send more than the destination can consume before this batch expires
            v_cap := CASE WHEN n.daily_rate > 0 THEN floor(n.daily_rate * c.days)::integer ELSE v_left END;
            v_q := least(v_left, v_blft, coalesce(v_slft, 0), v_cap);
            CONTINUE WHEN v_q IS NULL OR v_q <= 0;

            v_score := least(100,
                (CASE WHEN n.critical THEN 45 ELSE 30 END)
              + (CASE WHEN c.days <= 30 THEN 25 WHEN c.days <= 60 THEN 18 WHEN c.days <= 120 THEN 10 ELSE 3 END)
              + greatest(0, 20 - c.dist / 5)
              + (CASE WHEN n.demand_basis = 'MEASURED' THEN 10 ELSE 5 END));

            INSERT INTO redistribution_recommendations
                (reason_code, source_inventory_id, destination_facility_id, recommended_quantity,
                 projected_shortage_reduction, priority_score, explanation)
            VALUES ('SHORTAGE_COVER', c.inventory_id, n.facility_id, v_q, least(v_q, v_left), round(v_score, 2),
                format('%s is %s for %s: %s usable vs reorder level %s (%s days of cover, demand %s). '
                       '%s holds surplus; batch %s expires %s (%s days), %s km away.',
                       (SELECT name FROM facilities WHERE id = n.facility_id),
                       CASE WHEN n.critical THEN 'CRITICALLY short' ELSE 'below reorder level' END,
                       (SELECT name FROM medicines WHERE id = n.medicine_id),
                       n.usable, n.usable + n.deficit,
                       coalesce(round(n.cover_days, 1)::text, 'n/a'), lower(n.demand_basis),
                       c.src_name, c.batch_number, c.expiry_date, c.days, c.dist));

            UPDATE _eng_batch   SET remaining = remaining - v_q WHERE inventory_id = c.inventory_id;
            UPDATE _eng_surplus SET remaining = remaining - v_q WHERE facility_id = c.facility_id AND medicine_id = n.medicine_id;
            UPDATE _eng_need    SET deficit   = deficit   - v_q WHERE facility_id = n.facility_id AND medicine_id = n.medicine_id;
            v_left := v_left - v_q;
            v_count := v_count + 1;
        END LOOP;
    END LOOP;

    -- ---------------- Phase B: near-expiry excess (FEFO consumption model) ----------------
    -- Walk each facility's batches in expiry order; local demand consumes earlier
    -- batches first. Units of a batch that local demand cannot reach before its
    -- expiry are "excess" and are offered to the best nearby consumer.
    FOR rb IN
        SELECT p.facility_id, p.medicine_id, p.daily_rate, i.id AS inventory_id, bt.batch_number, bt.expiry_date,
               i.qty_available AS qty, (bt.expiry_date - fn_today()) AS days, f.name AS src_name
        FROM _eng_pair p
        JOIN inventory i         ON i.facility_id = p.facility_id
        JOIN medicine_batches bt ON bt.id = i.batch_id AND bt.medicine_id = p.medicine_id
        JOIN facilities f        ON f.id = p.facility_id
        WHERE bt.status = 'ACTIVE' AND bt.expiry_date >= fn_today() AND i.qty_available > 0
        ORDER BY p.facility_id, p.medicine_id, bt.expiry_date, i.id
    LOOP
        IF v_key IS DISTINCT FROM (rb.facility_id || ':' || rb.medicine_id) THEN
            v_key := rb.facility_id || ':' || rb.medicine_id;
            v_used := 0;
        END IF;
        v_cons := least(rb.qty, greatest(0, floor(rb.daily_rate * rb.days - v_used))::integer);
        v_used := v_used + v_cons;
        v_excess := rb.qty - v_cons;

        CONTINUE WHEN v_excess < 10
                   OR rb.days > cfg.near_expiry_window_days
                   OR rb.days < cfg.min_remaining_shelf_life_days;
        SELECT remaining INTO v_blft FROM _eng_batch WHERE inventory_id = rb.inventory_id;
        v_excess := least(v_excess, coalesce(v_blft, 0));
        CONTINUE WHEN v_excess < 10;

        SELECT f.id, f.name, fn_distance_km(rb.facility_id, f.id) AS dist, p2.daily_rate, p2.demand_basis,
               coalesce(ne.deficit, 0) AS deficit
          INTO d
        FROM facilities f
        JOIN _eng_pair p2     ON p2.facility_id = f.id AND p2.medicine_id = rb.medicine_id
        JOIN facilities src   ON src.id = rb.facility_id
        JOIN medicines m      ON m.id = rb.medicine_id
        LEFT JOIN _eng_need ne ON ne.facility_id = f.id AND ne.medicine_id = rb.medicine_id
        WHERE f.id <> rb.facility_id AND f.is_active AND p2.daily_rate > 0
          AND fn_is_transfer_authorised(rb.facility_id, f.id)
          AND (NOT m.requires_cold_chain OR (src.has_cold_chain AND f.has_cold_chain))
          AND fn_distance_km(rb.facility_id, f.id) <= src.max_dispatch_radius_km
          AND NOT EXISTS (SELECT 1 FROM redistribution_recommendations r
                          WHERE r.status = 'OPEN' AND r.source_inventory_id = rb.inventory_id AND r.destination_facility_id = f.id)
        ORDER BY p2.daily_rate / (1 + fn_distance_km(rb.facility_id, f.id) / 30) DESC
        LIMIT 1;
        CONTINUE WHEN NOT FOUND;

        v_q := least(v_excess, floor(d.daily_rate * rb.days * 0.8)::integer);
        CONTINUE WHEN v_q < 10;

        v_score := least(100,
            (CASE WHEN d.deficit > 0 THEN 30 ELSE 10 END)
          + (CASE WHEN rb.days <= 30 THEN 25 WHEN rb.days <= 60 THEN 18 ELSE 10 END)
          + greatest(0, 20 - d.dist / 5)
          + (CASE WHEN d.demand_basis = 'MEASURED' THEN 10 ELSE 5 END));

        INSERT INTO redistribution_recommendations
            (reason_code, source_inventory_id, destination_facility_id, recommended_quantity,
             projected_shortage_reduction, priority_score, explanation)
        VALUES ('NEAR_EXPIRY_SURPLUS', rb.inventory_id, d.id, v_q, least(v_q, greatest(d.deficit, 0)), round(v_score, 2),
            format('Batch %s at %s expires %s (%s days); local demand (%s/day) will use only %s of %s units before expiry. '
                   '%s consumes ~%s/day and is %s km away.',
                   rb.batch_number, rb.src_name, rb.expiry_date, rb.days, round(rb.daily_rate, 1), v_cons, rb.qty,
                   d.name, round(d.daily_rate, 1), d.dist));

        UPDATE _eng_batch SET remaining = remaining - v_q WHERE inventory_id = rb.inventory_id;
        v_count := v_count + 1;
    END LOOP;

    PERFORM fn_audit(p_actor, 'RECOMMENDATIONS_GENERATED', 'RECOMMENDATION', NULL, NULL, NULL,
                     jsonb_build_object('generated', v_count));
    RETURN v_count;
END $$;
