-- 008 — idempotent single-row stock actions
--
-- API_CONTRACT.md promises that every stock write honours an Idempotency-Key.
-- Receipts (sp_receive_stock) and transfer routines already did; the five
-- single-row ledger actions (dispense, damage, disposal, expiry write-off,
-- adjustment) did not, so a client retry after a lost response could record
-- the movement twice. This wrapper adds exactly-once semantics in the SAME
-- transaction as the ledger entry, reusing fn_idem_lookup / fn_idem_record:
--
--   * same key + same body  → returns the original movement id, writes nothing;
--   * same key + other body → MS422 IDEMPOTENCY_KEY_REUSED;
--   * concurrent retries    → the second blocks on the idempotency_keys primary
--                             key and fails with unique_violation once the first
--                             commits, so its duplicate ledger row rolls back.
--
-- Permission checks stay inside the wrapped SECURITY DEFINER functions.

CREATE FUNCTION fn_stock_action(
    p_actor           bigint,
    p_inventory       bigint,
    p_action          text,      -- dispense | damage | dispose | write-off | adjust
    p_quantity        integer,   -- for adjust: the signed delta; for write-off: NULL = all available
    p_reason          text,
    p_reference       text,
    p_idempotency_key uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_op       text  := 'stock.' || p_action;
    v_payload  jsonb := jsonb_build_object('inventory', p_inventory, 'quantity', p_quantity,
                                           'reason', p_reason, 'reference', p_reference);
    v_existing text;
    v_movement bigint;
BEGIN
    v_existing := fn_idem_lookup(p_actor, p_idempotency_key, v_op, v_payload);
    IF v_existing IS NOT NULL THEN
        RETURN v_existing::bigint;
    END IF;

    v_movement := CASE p_action
        WHEN 'dispense'  THEN fn_record_dispense(p_actor, p_inventory, p_quantity, p_reference)
        WHEN 'damage'    THEN fn_record_damage(p_actor, p_inventory, p_quantity, p_reason)
        WHEN 'dispose'   THEN fn_dispose_damaged(p_actor, p_inventory, p_quantity, p_reason)
        -- NULL quantity = everything available. It is resolved only after the key lookup,
        -- so a retry (when nothing is left) still matches the original request payload.
        WHEN 'write-off' THEN fn_write_off_expired(p_actor, p_inventory,
                                  coalesce(p_quantity, (SELECT qty_available FROM inventory WHERE id = p_inventory)), p_reason)
        WHEN 'adjust'    THEN fn_adjust_stock(p_actor, p_inventory, p_quantity, p_reason)
    END;
    IF v_movement IS NULL THEN
        PERFORM fn_fail('MS422', 'VALIDATION', format('Unknown stock action %s', p_action));
    END IF;

    PERFORM fn_idem_record(p_actor, p_idempotency_key, v_op, v_payload, 'INVENTORY_MOVEMENT', v_movement::text);
    RETURN v_movement;
END $$;

COMMENT ON FUNCTION fn_stock_action(bigint, bigint, text, integer, text, text, uuid)
    IS 'Exactly-once wrapper for single-row ledger actions (dispense, damage, dispose, write-off, adjust).';

REVOKE ALL ON FUNCTION fn_stock_action(bigint, bigint, text, integer, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_stock_action(bigint, bigint, text, integer, text, text, uuid) TO medshare_app;
