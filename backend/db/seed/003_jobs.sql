-- =============================================================================
-- SEED 003 — run the scheduled jobs "now" and verify integrity of the result.
-- =============================================================================

SELECT set_config('medshare.event_time', '', true);
SELECT fn_generate_expiry_alerts()        AS new_expiry_alerts;
SELECT fn_refresh_shortage_alerts()       AS open_shortage_alerts;
SELECT fn_generate_recommendations(NULL)  AS recommendations;
SELECT fn_refresh_analytics();

DROP TABLE IF EXISTS _seed_params;

SELECT fn_audit(NULL, 'SYNTHETIC_SEED_LOADED', 'SYSTEM', NULL, NULL, NULL,
       jsonb_build_object('organizations', (SELECT count(*) FROM organizations),
                          'facilities',    (SELECT count(*) FROM facilities),
                          'medicines',     (SELECT count(*) FROM medicines),
                          'batches',       (SELECT count(*) FROM medicine_batches),
                          'inventory',     (SELECT count(*) FROM inventory),
                          'movements',     (SELECT count(*) FROM inventory_movements),
                          'transfers',     (SELECT count(*) FROM transfer_requests),
                          'note',          'All records are synthetic demonstration data'));

DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad FROM fn_reconcile_inventory();
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Seed produced % reconciliation discrepancies', v_bad;
    END IF;
    RAISE NOTICE 'seed summary: % orgs · % facilities · % users · % medicines · % batches · % inventory rows · % movements · % transfers · % stock requests · % open shortage alerts · % open expiry alerts · % recommendations · reconciliation discrepancies: 0',
        (SELECT count(*) FROM organizations), (SELECT count(*) FROM facilities), (SELECT count(*) FROM users),
        (SELECT count(*) FROM medicines), (SELECT count(*) FROM medicine_batches), (SELECT count(*) FROM inventory),
        (SELECT count(*) FROM inventory_movements), (SELECT count(*) FROM transfer_requests), (SELECT count(*) FROM stock_requests),
        (SELECT count(*) FROM shortage_alerts WHERE status <> 'RESOLVED'), (SELECT count(*) FROM expiry_alerts WHERE status <> 'RESOLVED'),
        (SELECT count(*) FROM redistribution_recommendations WHERE status = 'OPEN');
END $$;
