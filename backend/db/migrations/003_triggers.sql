-- =============================================================================
-- 003 — triggers
-- Triggers guard invariants that must hold no matter which code path writes.
-- Workflow orchestration (approve / dispatch / receive) is deliberately NOT in
-- triggers: it lives in explicit procedures (004) where lock order is visible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE FUNCTION trg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := fn_now();
    RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','organizations','facilities','medicines','medicine_batches',
                             'stock_requests','transfer_requests','facility_medicine_settings','engine_config']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at()', t, t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Ledger → balance. The ONLY way inventory quantities change.
--    Runs inside the inserting transaction: if the balance would go negative,
--    inventory's CHECK constraint aborts the movement and everything with it.
-- -----------------------------------------------------------------------------
CREATE FUNCTION trg_movement_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    t movement_types;
BEGIN
    SELECT * INTO STRICT t FROM movement_types WHERE code = NEW.movement_type;

    IF t.requires_transfer_item AND NEW.transfer_item_id IS NULL THEN
        PERFORM fn_fail('MS422', 'MOVEMENT_REQUIRES_TRANSFER', format('%s movements must reference a transfer item', t.code));
    END IF;
    IF t.requires_reason AND coalesce(btrim(NEW.reason), '') = '' THEN
        PERFORM fn_fail('MS422', 'MOVEMENT_REQUIRES_REASON', format('%s movements require a reason', t.code));
    END IF;

    UPDATE inventory
       SET qty_available = qty_available + NEW.quantity * t.effect_available,
           qty_reserved  = qty_reserved  + NEW.quantity * t.effect_reserved,
           qty_damaged   = qty_damaged   + NEW.quantity * t.effect_damaged,
           updated_at    = NEW.created_at
     WHERE id = NEW.inventory_id;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_inventory_movements_apply
    BEFORE INSERT ON inventory_movements
    FOR EACH ROW EXECUTE FUNCTION trg_movement_apply();

-- -----------------------------------------------------------------------------
-- 2. Inventory guard: rows are created empty and changed only by the ledger
--    trigger (pg_trigger_depth() > 1). Never deleted.
-- -----------------------------------------------------------------------------
CREATE FUNCTION trg_inventory_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.qty_available <> 0 OR NEW.qty_reserved <> 0 OR NEW.qty_damaged <> 0 THEN
            PERFORM fn_fail('MS422', 'INVENTORY_DIRECT_WRITE', 'Inventory rows start at zero; quantities arrive through movements');
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM fn_fail('MS403', 'INVENTORY_DIRECT_WRITE', 'Inventory rows are never deleted (history would be lost)');
    ELSIF pg_trigger_depth() < 2 THEN
        PERFORM fn_fail('MS403', 'INVENTORY_DIRECT_WRITE', 'Inventory balances can only change through inventory_movements');
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_inventory_guard
    BEFORE INSERT OR UPDATE OR DELETE ON inventory
    FOR EACH ROW EXECUTE FUNCTION trg_inventory_guard();

-- -----------------------------------------------------------------------------
-- 3. Append-only tables (UPDATE / DELETE / TRUNCATE blocked)
-- -----------------------------------------------------------------------------
CREATE FUNCTION trg_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_fail('MS403', 'APPEND_ONLY', format('%s is append-only; %s is not permitted', TG_TABLE_NAME, TG_OP));
    RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['inventory_movements','audit_logs','transfer_status_history','transfer_approvals']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_%s_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_append_only()', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trg_append_only()', t, t);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Transfer state machine + history
--    PENDING  → APPROVED | REJECTED | CANCELLED
--    APPROVED → DISPATCHED | CANCELLED       (cancel releases the reservation)
--    DISPATCHED → RECEIVED
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_transfer_transition_allowed(p_from transfer_status, p_to transfer_status) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_from, p_to) IN (
        ('PENDING'::transfer_status,  'APPROVED'::transfer_status),
        ('PENDING',  'REJECTED'),
        ('PENDING',  'CANCELLED'),
        ('APPROVED', 'DISPATCHED'),
        ('APPROVED', 'CANCELLED'),
        ('DISPATCHED', 'RECEIVED'))
$$;

CREATE FUNCTION trg_transfer_state_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING' THEN
            PERFORM fn_fail('MS409', 'INVALID_STATE', 'Transfers are created PENDING');
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.code IS DISTINCT FROM OLD.code
       OR NEW.source_facility_id IS DISTINCT FROM OLD.source_facility_id
       OR NEW.destination_facility_id IS DISTINCT FROM OLD.destination_facility_id
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        PERFORM fn_fail('MS422', 'IMMUTABLE_FIELD', 'Transfer route, code, requester and creation time cannot change');
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT fn_transfer_transition_allowed(OLD.status, NEW.status) THEN
        PERFORM fn_fail('MS409', 'INVALID_STATE', format('Illegal transfer transition %s → %s', OLD.status, NEW.status));
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_transfer_state_validate
    BEFORE INSERT OR UPDATE ON transfer_requests
    FOR EACH ROW EXECUTE FUNCTION trg_transfer_state_validate();

CREATE FUNCTION trg_transfer_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_actor bigint := fn_actor();
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NULL;
    END IF;
    IF v_actor IS NULL THEN
        PERFORM fn_fail('MS422', 'ACTOR_REQUIRED', 'Transfer status changes require medshare.actor_id (use the transfer procedures)');
    END IF;
    INSERT INTO transfer_status_history (transfer_id, to_status, changed_by, note)
    VALUES (NEW.id, NEW.status, v_actor, nullif(current_setting('medshare.transition_note', true), ''));
    RETURN NULL;
END $$;

CREATE TRIGGER trg_transfer_history
    AFTER INSERT OR UPDATE OF status ON transfer_requests
    FOR EACH ROW EXECUTE FUNCTION trg_transfer_history();

-- -----------------------------------------------------------------------------
-- 5. Stock-threshold alerts. Re-evaluates (facility, medicine) whenever usable
--    stock or the policy changes; opens, escalates, de-escalates or resolves.
--    The partial unique index + ON CONFLICT make racing evaluations safe.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_evaluate_shortage(p_facility integer, p_medicine integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    s        facility_medicine_settings;
    v_usable integer;
    v_sev    shortage_severity;
    v_thr    integer;
    v_old    shortage_alerts;
BEGIN
    SELECT * INTO s FROM facility_medicine_settings WHERE facility_id = p_facility AND medicine_id = p_medicine;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT coalesce(sum(i.qty_available), 0) INTO v_usable
    FROM inventory i JOIN medicine_batches b ON b.id = i.batch_id
    WHERE i.facility_id = p_facility AND b.medicine_id = p_medicine
      AND b.status = 'ACTIVE' AND b.expiry_date >= fn_today();

    IF v_usable < s.min_stock_level THEN v_sev := 'CRITICAL'; v_thr := s.min_stock_level;
    ELSIF v_usable < s.reorder_threshold THEN v_sev := 'LOW'; v_thr := s.reorder_threshold;
    END IF;

    SELECT * INTO v_old FROM shortage_alerts
    WHERE facility_id = p_facility AND medicine_id = p_medicine AND status <> 'RESOLVED';

    IF v_sev IS NULL THEN
        IF FOUND THEN
            UPDATE shortage_alerts SET status = 'RESOLVED', resolved_at = fn_now() WHERE id = v_old.id;
        END IF;
        RETURN;
    END IF;

    IF FOUND AND v_old.severity = v_sev THEN
        RETURN;                                            -- unchanged
    END IF;

    INSERT INTO shortage_alerts (facility_id, medicine_id, severity, stock_at_detection, threshold_at_detection)
    VALUES (p_facility, p_medicine, v_sev, v_usable, v_thr)
    ON CONFLICT (facility_id, medicine_id) WHERE status <> 'RESOLVED'
    DO UPDATE SET severity = EXCLUDED.severity,
                  stock_at_detection = EXCLUDED.stock_at_detection,
                  threshold_at_detection = EXCLUDED.threshold_at_detection,
                  detected_at = fn_now();

    IF v_sev = 'CRITICAL' AND (v_old.id IS NULL OR v_old.severity = 'LOW') THEN
        PERFORM fn_notify_facility_role(p_facility, 'FACILITY_MANAGER', 'SHORTAGE',
            'Critical shortage',
            format('%s is below its minimum stock level (%s of %s units).',
                   (SELECT name FROM medicines WHERE id = p_medicine), v_usable, s.min_stock_level),
            'MEDICINE', p_medicine::text);
    END IF;
END $$;

CREATE FUNCTION trg_inventory_threshold() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_evaluate_shortage(NEW.facility_id, (SELECT medicine_id FROM medicine_batches WHERE id = NEW.batch_id));
    RETURN NULL;
END $$;

CREATE TRIGGER trg_inventory_threshold
    AFTER UPDATE OF qty_available ON inventory
    FOR EACH ROW WHEN (OLD.qty_available IS DISTINCT FROM NEW.qty_available)
    EXECUTE FUNCTION trg_inventory_threshold();

CREATE FUNCTION trg_settings_threshold() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_evaluate_shortage(NEW.facility_id, NEW.medicine_id);
    RETURN NULL;
END $$;

CREATE TRIGGER trg_settings_threshold
    AFTER INSERT OR UPDATE OF min_stock_level, reorder_threshold ON facility_medicine_settings
    FOR EACH ROW EXECUTE FUNCTION trg_settings_threshold();

-- Batch status changes (quarantine / recall) change usable stock everywhere.
CREATE FUNCTION trg_batch_status_threshold() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE f integer;
BEGIN
    FOR f IN SELECT facility_id FROM inventory WHERE batch_id = NEW.id LOOP
        PERFORM fn_evaluate_shortage(f, NEW.medicine_id);
    END LOOP;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_batch_status_threshold
    AFTER UPDATE OF status ON medicine_batches
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_batch_status_threshold();

-- -----------------------------------------------------------------------------
-- 6. Audit important inventory modifications (losses, corrections, large moves)
-- -----------------------------------------------------------------------------
CREATE FUNCTION trg_audit_inventory_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_inv inventory;
BEGIN
    IF NEW.movement_type IN ('DAMAGE', 'DISPOSAL', 'EXPIRY_WRITE_OFF', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSIT_DAMAGE')
       OR NEW.quantity >= (SELECT large_adjustment_audit_units FROM engine_config) THEN
        SELECT * INTO v_inv FROM inventory WHERE id = NEW.inventory_id;
        PERFORM fn_audit(NEW.performed_by, 'INVENTORY_' || NEW.movement_type, 'INVENTORY', NEW.inventory_id::text,
                         v_inv.facility_id, NULL,
                         jsonb_build_object('movement_id', NEW.id, 'quantity', NEW.quantity, 'reason', NEW.reason,
                                            'reference', NEW.reference, 'batch_id', v_inv.batch_id,
                                            'balance_after', jsonb_build_object('available', v_inv.qty_available,
                                                                                'reserved', v_inv.qty_reserved,
                                                                                'damaged', v_inv.qty_damaged)));
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_inventory_change
    AFTER INSERT ON inventory_movements
    FOR EACH ROW EXECUTE FUNCTION trg_audit_inventory_change();

-- Batch status changes are audited too.
CREATE FUNCTION trg_audit_batch_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_audit(fn_actor(), 'BATCH_STATUS_CHANGED', 'BATCH', NEW.id::text, NULL,
                     jsonb_build_object('status', OLD.status),
                     jsonb_build_object('status', NEW.status, 'reason', NEW.status_reason));
    RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_batch_status
    AFTER UPDATE OF status ON medicine_batches
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trg_audit_batch_status();

-- -----------------------------------------------------------------------------
-- 7. Cross-row integrity that CHECK constraints cannot express
-- -----------------------------------------------------------------------------

-- Role granted at a level its definition allows.
CREATE FUNCTION trg_validate_role_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_level role_grant_level;
BEGIN
    SELECT grant_level INTO v_level FROM roles WHERE id = NEW.role_id;
    IF TG_TABLE_NAME = 'facility_users' THEN
        IF v_level <> 'FACILITY' THEN
            PERFORM fn_fail('MS422', 'INVALID_ROLE_SCOPE', 'Only facility-level roles can be assigned to a facility');
        END IF;
    ELSIF v_level = 'FACILITY'
       OR (v_level = 'PLATFORM' AND NEW.organization_id IS NOT NULL)
       OR (v_level = 'ORGANIZATION' AND NEW.organization_id IS NULL) THEN
        PERFORM fn_fail('MS422', 'INVALID_ROLE_SCOPE', format('Role cannot be granted at this level (%s)', v_level));
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_user_roles_validate     BEFORE INSERT OR UPDATE ON user_roles     FOR EACH ROW EXECUTE FUNCTION trg_validate_role_grant();
CREATE TRIGGER trg_facility_users_validate BEFORE INSERT OR UPDATE ON facility_users FOR EACH ROW EXECUTE FUNCTION trg_validate_role_grant();

-- Hierarchies must stay acyclic (recursive walk up from the new parent).
CREATE FUNCTION trg_no_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cycle boolean;
BEGIN
    IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
    EXECUTE format($q$
        WITH RECURSIVE up AS (
            SELECT id, parent_id FROM %1$I WHERE id = $1
            UNION ALL
            SELECT t.id, t.parent_id FROM %1$I t JOIN up ON t.id = up.parent_id
        ) CYCLE id SET is_cycle USING path
        SELECT EXISTS (SELECT 1 FROM up WHERE id = $2)$q$, TG_TABLE_NAME)
    INTO v_cycle USING NEW.parent_id, NEW.id;
    IF v_cycle THEN
        PERFORM fn_fail('MS422', 'HIERARCHY_CYCLE', format('%s %s cannot be its own ancestor', TG_TABLE_NAME, NEW.id));
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_regions_no_cycle    BEFORE INSERT OR UPDATE OF parent_id ON regions             FOR EACH ROW EXECUTE FUNCTION trg_no_cycle();
CREATE TRIGGER trg_categories_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON medicine_categories FOR EACH ROW EXECUTE FUNCTION trg_no_cycle();

-- Medicine composition: ≥ 1 ingredient, and no two medicines with the same
-- dosage form, volume and ingredient set. Deferred to commit so a medicine and
-- its ingredients can be inserted in any order within one transaction.
CREATE FUNCTION fn_check_medicine_composition(p_medicine integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    m     medicines;
    v_sig text;
    v_dup text;
BEGIN
    SELECT * INTO m FROM medicines WHERE id = p_medicine;
    IF NOT FOUND THEN RETURN; END IF;                       -- medicine deleted in this transaction

    SELECT string_agg(substance_id || ':' || trim_scale(strength_value) || strength_uom, ',' ORDER BY substance_id)
      INTO v_sig FROM medicine_ingredients WHERE medicine_id = p_medicine;
    IF v_sig IS NULL THEN
        PERFORM fn_fail('MS422', 'MEDICINE_WITHOUT_INGREDIENT', format('Medicine %s must have at least one ingredient', m.code));
    END IF;

    SELECT o.code INTO v_dup
    FROM medicines o
    WHERE o.id <> m.id AND o.dosage_form = m.dosage_form
      AND o.unit_volume_ml IS NOT DISTINCT FROM m.unit_volume_ml
      AND (SELECT string_agg(substance_id || ':' || trim_scale(strength_value) || strength_uom, ',' ORDER BY substance_id)
           FROM medicine_ingredients WHERE medicine_id = o.id) = v_sig
    LIMIT 1;
    IF v_dup IS NOT NULL THEN
        PERFORM fn_fail('MS409', 'DUPLICATE_MEDICINE', format('Medicine %s duplicates %s (same form and composition)', m.code, v_dup));
    END IF;
END $$;

CREATE FUNCTION trg_medicine_composition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'medicines' THEN
        PERFORM fn_check_medicine_composition(NEW.id);
    ELSE
        PERFORM fn_check_medicine_composition(CASE WHEN TG_OP = 'DELETE' THEN OLD.medicine_id ELSE NEW.medicine_id END);
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_medicines_composition
    AFTER INSERT OR UPDATE OF dosage_form, unit_volume_ml ON medicines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION trg_medicine_composition();

CREATE CONSTRAINT TRIGGER trg_ingredients_composition
    AFTER INSERT OR UPDATE OR DELETE ON medicine_ingredients
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION trg_medicine_composition();

-- Recommendations: the source facility must differ from the destination.
CREATE FUNCTION trg_recommendation_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT facility_id FROM inventory WHERE id = NEW.source_inventory_id) = NEW.destination_facility_id THEN
        PERFORM fn_fail('MS422', 'SAME_FACILITY', 'Recommendation source and destination must differ');
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_recommendation_validate
    BEFORE INSERT ON redistribution_recommendations
    FOR EACH ROW EXECUTE FUNCTION trg_recommendation_validate();
