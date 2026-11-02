-- =============================================================================
-- 002 — core functions & RBAC reference data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clock. fn_now() is the single time source for every event timestamp.
-- A superuser session (the seed / test runner) may set `medshare.event_time`
-- to back-date synthetic history; the application role can never do so.
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_now() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v text := current_setting('medshare.event_time', true);
BEGIN
    IF v IS NOT NULL AND v <> ''
       AND (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN
        RETURN v::timestamptz;
    END IF;
    RETURN clock_timestamp();
END $$;

CREATE FUNCTION fn_today() RETURNS date
LANGUAGE sql VOLATILE AS $$ SELECT (fn_now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Event-time defaults on every event table.
ALTER TABLE users                          ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE organizations                  ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE facilities                     ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE medicines                      ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE medicine_batches               ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE inventory                      ALTER COLUMN updated_at   SET DEFAULT fn_now();
ALTER TABLE inventory_movements            ALTER COLUMN created_at   SET DEFAULT fn_now();
ALTER TABLE stock_requests                 ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE redistribution_recommendations ALTER COLUMN generated_at SET DEFAULT fn_now();
ALTER TABLE transfer_requests              ALTER COLUMN created_at   SET DEFAULT fn_now(), ALTER COLUMN updated_at SET DEFAULT fn_now();
ALTER TABLE transfer_approvals             ALTER COLUMN decided_at   SET DEFAULT fn_now();
ALTER TABLE transfer_status_history        ALTER COLUMN changed_at   SET DEFAULT fn_now();
ALTER TABLE expiry_alerts                  ALTER COLUMN detected_at  SET DEFAULT fn_now();
ALTER TABLE shortage_alerts                ALTER COLUMN detected_at  SET DEFAULT fn_now();
ALTER TABLE notifications                  ALTER COLUMN created_at   SET DEFAULT fn_now();
ALTER TABLE audit_logs                     ALTER COLUMN occurred_at  SET DEFAULT fn_now();
ALTER TABLE idempotency_keys               ALTER COLUMN created_at   SET DEFAULT fn_now();
ALTER TABLE user_roles                     ALTER COLUMN granted_at   SET DEFAULT fn_now();
ALTER TABLE facility_users                 ALTER COLUMN assigned_at  SET DEFAULT fn_now();

-- -----------------------------------------------------------------------------
-- Actor context (transaction-local), read by triggers that need "who".
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_set_actor(p_user_id bigint) RETURNS void
LANGUAGE sql AS $$ SELECT set_config('medshare.actor_id', p_user_id::text, true) $$;

CREATE FUNCTION fn_actor() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('medshare.actor_id', true), '')::bigint $$;

-- Procedures clear the context right after the change it was set for, so it
-- never leaks to later statements in the same transaction.
CREATE FUNCTION fn_clear_actor() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('medshare.actor_id', '', true);
    PERFORM set_config('medshare.transition_note', '', true);
END $$;

-- -----------------------------------------------------------------------------
-- Business errors. SQLSTATE carries the HTTP class, HINT the stable API code:
--   MS403 forbidden · MS404 not found · MS409 conflict/state · MS422 validation
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_fail(p_sqlstate text, p_code text, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = p_sqlstate, MESSAGE = p_message, HINT = p_code;
END $$;

-- -----------------------------------------------------------------------------
-- RBAC reference data
-- -----------------------------------------------------------------------------
INSERT INTO roles (code, name, grant_level, description) OVERRIDING SYSTEM VALUE VALUES
    ('SYSTEM_ADMIN',      'System administrator',       'PLATFORM',                 'Manages organisations, agreements, users and reference data. Not an operational approver.'),
    ('ORG_ADMIN',         'Organisation administrator', 'ORGANIZATION',             'Manages one organisation; gives organisation-level approval for cross-organisation transfers.'),
    ('FACILITY_MANAGER',  'Facility manager',           'FACILITY',                 'Configures stock policy and approves outgoing transfers at assigned facilities.'),
    ('INVENTORY_MANAGER', 'Inventory manager',          'FACILITY',                 'Records receipts, dispensing and damage; raises, dispatches and receives transfers.'),
    ('AUDITOR',           'Auditor',                    'PLATFORM_OR_ORGANIZATION', 'Read-only access to records and audit logs in scope.');

INSERT INTO permissions (code, description) VALUES
    ('organization:manage',   'Create and edit organisations and agreements'),
    ('user:manage',           'Create users and grant roles'),
    ('facility:manage',       'Create and edit facilities'),
    ('catalogue:manage',      'Add and edit medicines, categories, substances, manufacturers'),
    ('batch:manage',          'Quarantine, recall or re-activate a batch network-wide'),
    ('inventory:read',        'View batch-level inventory and movements'),
    ('inventory:write',       'Receive stock, dispense, record damage, adjust, write off'),
    ('settings:manage',       'Configure facility stock policy'),
    ('request:create',        'Raise stock requests'),
    ('transfer:request',      'Create transfer requests'),
    ('transfer:approve',      'Approve or reject transfers at the source facility stage'),
    ('transfer:approve_org',  'Approve or reject transfers at the source organisation stage'),
    ('transfer:dispatch',     'Record dispatch of an approved transfer'),
    ('transfer:receive',      'Confirm receipt of a dispatched transfer'),
    ('recommendation:manage', 'Generate and dismiss redistribution recommendations'),
    ('report:read',           'View analytics and reports'),
    ('audit:read',            'View audit logs');

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
JOIN (VALUES
    ('SYSTEM_ADMIN',      ARRAY['organization:manage','user:manage','facility:manage','catalogue:manage','batch:manage',
                                'inventory:read','recommendation:manage','report:read','audit:read']),
    ('ORG_ADMIN',         ARRAY['user:manage','facility:manage','catalogue:manage','inventory:read','transfer:approve_org',
                                'recommendation:manage','report:read','audit:read']),
    ('FACILITY_MANAGER',  ARRAY['inventory:read','inventory:write','settings:manage','request:create','transfer:request',
                                'transfer:approve','transfer:dispatch','transfer:receive','recommendation:manage','report:read']),
    ('INVENTORY_MANAGER', ARRAY['inventory:read','inventory:write','request:create','transfer:request',
                                'transfer:dispatch','transfer:receive','report:read']),
    ('AUDITOR',           ARRAY['inventory:read','report:read','audit:read'])
) AS m(role_code, perms) ON m.role_code = r.code
CROSS JOIN LATERAL unnest(m.perms) AS u(code)
JOIN permissions p ON p.code = u.code;

INSERT INTO engine_config DEFAULT VALUES;

-- -----------------------------------------------------------------------------
-- Authorisation
-- -----------------------------------------------------------------------------

-- Does the user hold `perm` for `facility`? Facility grants apply to that
-- facility; organisation grants to every facility of the organisation;
-- platform grants everywhere. p_facility NULL asks "at platform level".
CREATE FUNCTION fn_user_has_permission(p_user bigint, p_facility integer, p_perm text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u WHERE u.id = p_user AND u.is_active
    ) AND (
        EXISTS (SELECT 1
                FROM facility_users fu
                JOIN role_permissions rp ON rp.role_id = fu.role_id
                WHERE fu.user_id = p_user AND fu.facility_id = p_facility AND rp.permission_code = p_perm)
     OR EXISTS (SELECT 1
                FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                LEFT JOIN facilities f ON f.id = p_facility
                WHERE ur.user_id = p_user AND rp.permission_code = p_perm
                  AND (ur.organization_id IS NULL OR ur.organization_id = f.organization_id))
    )
$$;

CREATE FUNCTION fn_require_permission(p_user bigint, p_facility integer, p_perm text) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF NOT fn_user_has_permission(p_user, p_facility, p_perm) THEN
        PERFORM fn_fail('MS403', 'FORBIDDEN',
            format('User %s lacks permission %s%s', p_user, p_perm,
                   CASE WHEN p_facility IS NULL THEN '' ELSE format(' at facility %s', p_facility) END));
    END IF;
END $$;

-- Facilities whose operational detail the user may see (service-layer read scoping).
CREATE FUNCTION fn_user_facility_ids(p_user bigint) RETURNS SETOF integer
LANGUAGE sql STABLE AS $$
    SELECT fu.facility_id FROM facility_users fu JOIN users u ON u.id = fu.user_id AND u.is_active WHERE fu.user_id = p_user
    UNION
    SELECT f.id FROM facilities f
    JOIN user_roles ur ON ur.user_id = p_user AND (ur.organization_id IS NULL OR ur.organization_id = f.organization_id)
    JOIN users u ON u.id = ur.user_id AND u.is_active
$$;

-- Same organisation, or an organisation agreement in force today.
CREATE FUNCTION fn_is_transfer_authorised(p_source integer, p_destination integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN s.organization_id = d.organization_id THEN true
           ELSE EXISTS (
               SELECT 1 FROM organization_agreements a
               WHERE a.organization_a_id = least(s.organization_id, d.organization_id)
                 AND a.organization_b_id = greatest(s.organization_id, d.organization_id)
                 AND daterange(a.valid_from, a.valid_to, '[)') @> fn_today())
           END
    FROM facilities s, facilities d
    WHERE s.id = p_source AND d.id = p_destination
$$;

-- Great-circle distance × 1.3 road factor (documented approximation).
CREATE FUNCTION fn_distance_km(p_a integer, p_b integer) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT round((2 * 6371 * asin(sqrt(
               power(sin(radians(b.latitude - a.latitude) / 2), 2)
             + cos(radians(a.latitude)) * cos(radians(b.latitude))
             * power(sin(radians(b.longitude - a.longitude) / 2), 2))) * 1.3)::numeric, 1)
    FROM facilities a, facilities b
    WHERE a.id = p_a AND b.id = p_b
$$;

-- Composed strength label, e.g. 'Artemether + Lumefantrine 20 mg + 120 mg'.
CREATE FUNCTION fn_strength_label(p_medicine integer) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT string_agg(trim_scale(i.strength_value)::text || ' ' || i.strength_uom, ' + ' ORDER BY s.name)
    FROM medicine_ingredients i JOIN substances s ON s.id = i.substance_id
    WHERE i.medicine_id = p_medicine
$$;

-- -----------------------------------------------------------------------------
-- Idempotency helpers (used inside the same transaction as the operation)
-- -----------------------------------------------------------------------------

-- Returns the resource id of a previous identical call, or NULL to proceed.
CREATE FUNCTION fn_idem_lookup(p_user bigint, p_key uuid, p_operation text, p_payload jsonb) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_hash text := encode(sha256(convert_to(p_operation || ':' || p_payload::text, 'UTF8')), 'hex');
    v_row  idempotency_keys;
BEGIN
    IF p_key IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_row FROM idempotency_keys WHERE user_id = p_user AND idem_key = p_key;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_row.operation <> p_operation OR v_row.request_hash <> v_hash THEN
        PERFORM fn_fail('MS422', 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for a different request');
    END IF;
    RETURN v_row.resource_id;
END $$;

-- Records the key. A concurrent retry with the same key blocks on the primary
-- key and then fails with unique_violation, rolling back its duplicate work.
CREATE FUNCTION fn_idem_record(p_user bigint, p_key uuid, p_operation text, p_payload jsonb,
                               p_resource_type text, p_resource_id text) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO idempotency_keys (user_id, idem_key, operation, request_hash, resource_type, resource_id)
    SELECT p_user, p_key, p_operation,
           encode(sha256(convert_to(p_operation || ':' || p_payload::text, 'UTF8')), 'hex'),
           p_resource_type, p_resource_id
    WHERE p_key IS NOT NULL
$$;

-- -----------------------------------------------------------------------------
-- Audit & notification helpers
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_audit(p_actor bigint, p_action text, p_entity_type text, p_entity_id text,
                         p_facility integer, p_old jsonb, p_new jsonb) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, facility_id, old_values, new_values)
    VALUES (p_actor, p_action, p_entity_type, p_entity_id, p_facility, p_old, p_new)
$$;

-- Notify every active holder of `p_role_code` at a facility.
CREATE FUNCTION fn_notify_facility_role(p_facility integer, p_role_code text, p_category text,
                                        p_title text, p_body text, p_entity_type text, p_entity_id text) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO notifications (recipient_user_id, category, title, body, entity_type, entity_id)
    SELECT DISTINCT fu.user_id, p_category, p_title, p_body, p_entity_type, p_entity_id
    FROM facility_users fu
    JOIN roles r ON r.id = fu.role_id AND r.code = p_role_code
    JOIN users u ON u.id = fu.user_id AND u.is_active
    WHERE fu.facility_id = p_facility
$$;
