-- =============================================================================
-- 006 — least-privilege grants
-- medshare_app may READ everything it needs but may only CHANGE stock and
-- transfer state through SECURITY DEFINER routines. medshare_readonly sees views.
-- =============================================================================

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, medshare_app, medshare_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;

-- Reads
GRANT SELECT ON ALL TABLES IN SCHEMA public TO medshare_app;          -- includes views
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA public TO medshare_app;       -- identity columns on permitted inserts

-- Master data and administration (Prisma CRUD, guarded by the service layer)
GRANT INSERT, UPDATE ON users, organizations, organization_agreements, facilities, regions,
                        medicine_categories, medicine_units, substances, medicines, manufacturers,
                        facility_medicine_settings TO medshare_app;
GRANT INSERT, UPDATE, DELETE ON medicine_ingredients TO medshare_app;
GRANT INSERT, DELETE ON user_roles, facility_users TO medshare_app;
GRANT UPDATE ON engine_config TO medshare_app;
GRANT UPDATE (read_at) ON notifications TO medshare_app;
GRANT INSERT ON audit_logs TO medshare_app;                          -- append-only (trigger blocks UPDATE/DELETE)
GRANT UPDATE (status, acknowledged_by, acknowledged_at) ON expiry_alerts, shortage_alerts TO medshare_app;

-- Deliberately NOT granted: any write on inventory, inventory_movements, medicine_batches,
-- transfer_requests, transfer_items, transfer_approvals, transfer_status_history,
-- stock_requests, stock_request_items, stock_request_fulfilments,
-- redistribution_recommendations, idempotency_keys, movement_types, roles, permissions.

-- Routines the API may call
GRANT EXECUTE ON FUNCTION
    fn_now(), fn_today(),
    fn_user_has_permission(bigint, integer, text),
    fn_user_facility_ids(bigint),
    fn_is_transfer_authorised(integer, integer),
    fn_distance_km(integer, integer),
    fn_strength_label(integer),
    fn_create_transfer_request(bigint, integer, integer, jsonb, text, bigint, uuid),
    fn_record_dispense(bigint, bigint, integer, text),
    fn_record_damage(bigint, bigint, integer, text),
    fn_dispose_damaged(bigint, bigint, integer, text),
    fn_write_off_expired(bigint, bigint, integer, text),
    fn_adjust_stock(bigint, bigint, integer, text),
    fn_set_batch_status(bigint, bigint, batch_status, text),
    fn_create_stock_request(bigint, integer, jsonb, request_priority, date, text),
    fn_cancel_stock_request(bigint, bigint, text),
    fn_dismiss_recommendation(bigint, bigint, text),
    fn_reconcile_inventory(integer),
    fn_generate_expiry_alerts(),
    fn_refresh_shortage_alerts(),
    fn_generate_recommendations(bigint),
    fn_refresh_analytics()
TO medshare_app;

GRANT EXECUTE ON PROCEDURE
    sp_approve_transfer(bigint, bigint, approval_stage, text, uuid, transfer_status),
    sp_reject_transfer(bigint, bigint, text, approval_stage, uuid, transfer_status),
    sp_cancel_transfer(bigint, bigint, text, uuid, transfer_status),
    sp_dispatch_transfer(bigint, bigint, text, uuid, transfer_status),
    sp_receive_transfer(bigint, bigint, jsonb, text, uuid, transfer_status),
    sp_receive_stock(bigint, integer, integer, integer, text, date, date, numeric, integer, text, uuid, bigint),
    sp_reconcile_inventory(bigint, integer, integer)
TO medshare_app;

-- Functions used inside views must be executable by view readers.
GRANT EXECUTE ON FUNCTION fn_now(), fn_today(), fn_strength_label(integer) TO medshare_readonly;

-- Read-only reporting role: views only
GRANT SELECT ON v_region_tree, v_category_tree, v_medicine_catalogue, v_inventory_detail, v_facility_stock,
                v_demand, v_shortage_status, v_critical_shortages, v_expiring_inventory,
                v_facility_inventory_summary, v_medicine_availability, v_pending_transfers,
                v_transfer_timeline, v_org_inventory_analytics, mv_monthly_consumption
TO medshare_readonly;
