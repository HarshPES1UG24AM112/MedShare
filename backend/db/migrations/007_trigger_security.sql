-- =============================================================================
-- 007 — trigger functions run as their owner
--
-- Found by the API integration tests: a trigger fired by a medshare_app write
-- (e.g. the deferred medicine-composition check, or the shortage evaluation
-- fired by a stock-policy update) executes as the invoking role, so its calls
-- to internal helpers (fn_check_medicine_composition, fn_evaluate_shortage,
-- fn_notify_facility_role, fn_audit, fn_fail…) were denied — EXECUTE on those
-- is deliberately not granted to the app role.
--
-- Making every trigger function SECURITY DEFINER (with a pinned search_path)
-- keeps the helpers private while letting the invariants they enforce run.
-- =============================================================================

DO $$
DECLARE
    f record;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
    LOOP
        EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = public, pg_temp', f.sig);
    END LOOP;
END $$;
