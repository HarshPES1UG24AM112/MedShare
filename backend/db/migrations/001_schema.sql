-- =============================================================================
-- 001 — MedShare relational schema (PostgreSQL 16), runs as medshare_owner
--
-- SIMULATED institutional inventory coordination platform. All seeded data
-- is synthetic. Types, tables, keys, constraints, indexes and reference data.
-- Design rationale: backend/docs/PHASE1_DATABASE_DESIGN.md
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive e-mail keys
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- trigram indexes for medicine search
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraint on agreement periods
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- bcrypt hashes for synthetic seed users only

-- -----------------------------------------------------------------------------
-- Enumerated domains (closed, stable value sets; state machines)
-- -----------------------------------------------------------------------------
CREATE TYPE role_grant_level      AS ENUM ('PLATFORM', 'ORGANIZATION', 'PLATFORM_OR_ORGANIZATION', 'FACILITY');
CREATE TYPE organization_type     AS ENUM ('HOSPITAL_NETWORK', 'PHARMACY_CHAIN', 'PUBLIC_HEALTH_AUTHORITY', 'MEDICAL_WAREHOUSE', 'NGO');
CREATE TYPE facility_type         AS ENUM ('HOSPITAL', 'COMMUNITY_HEALTH_CENTRE', 'PRIMARY_HEALTH_CENTRE', 'PHARMACY', 'WAREHOUSE');
CREATE TYPE dosage_form           AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'INFUSION', 'INHALER', 'SACHET', 'CREAM', 'DROPS');
CREATE TYPE batch_status          AS ENUM ('ACTIVE', 'QUARANTINED', 'RECALLED');  -- "expired" is derived from expiry_date, never stored
CREATE TYPE request_priority      AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');
CREATE TYPE stock_request_status  AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE transfer_status       AS ENUM ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'REJECTED', 'CANCELLED');
CREATE TYPE approval_stage        AS ENUM ('SOURCE_FACILITY', 'SOURCE_ORGANIZATION');
CREATE TYPE approval_decision     AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE expiry_level          AS ENUM ('EXPIRED', 'WITHIN_7_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS');
CREATE TYPE shortage_severity     AS ENUM ('CRITICAL', 'LOW');
CREATE TYPE alert_status          AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE recommendation_reason AS ENUM ('SHORTAGE_COVER', 'NEAR_EXPIRY_SURPLUS');
CREATE TYPE recommendation_status AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED');

-- =============================================================================
-- 1. Identity & access control
-- =============================================================================

CREATE TABLE users (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email           citext      NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    password_hash   text        NOT NULL CHECK (password_hash LIKE '$2%'),   -- bcrypt only
    full_name       text        NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
    is_active       boolean     NOT NULL DEFAULT true,                      -- users are deactivated, never deleted
    is_synthetic    boolean     NOT NULL DEFAULT false,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id              smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            text             NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]+$'),
    name            text             NOT NULL UNIQUE,
    grant_level     role_grant_level NOT NULL,
    description     text
);

CREATE TABLE permissions (
    code            text PRIMARY KEY CHECK (code ~ '^[a-z_]+:[a-z_]+$'),  -- e.g. 'inventory:write'
    description     text NOT NULL
);

CREATE TABLE role_permissions (
    role_id         smallint NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_code text     NOT NULL REFERENCES permissions (code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

-- =============================================================================
-- 2. Organisations, geography, facilities
-- =============================================================================

-- Administrative hierarchy (state > district > taluk). The level is NOT stored:
-- it is the node's depth, derived with a recursive CTE (storing it would make
-- level transitively dependent on parent_id).
CREATE TABLE regions (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id       integer REFERENCES regions (id) ON DELETE RESTRICT,
    code            text    NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]+$'),
    name            text    NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id),
    UNIQUE NULLS NOT DISTINCT (parent_id, name)
);

CREATE TABLE organizations (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                text              NOT NULL UNIQUE,
    org_type            organization_type NOT NULL,
    registration_number text              NOT NULL UNIQUE,
    contact_email       citext            CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    is_active           boolean           NOT NULL DEFAULT true,
    is_synthetic        boolean           NOT NULL DEFAULT true,
    created_at          timestamptz       NOT NULL DEFAULT now(),
    updated_at          timestamptz       NOT NULL DEFAULT now()
);

-- Cross-organisation transfers are authorised only while an agreement is in force.
-- The pair is stored once in canonical order (a < b); periods may not overlap.
CREATE TABLE organization_agreements (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_a_id   integer     NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    organization_b_id   integer     NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    valid_from          date        NOT NULL,
    valid_to            date,                                   -- NULL = open-ended
    created_by          bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_agreement_canonical_pair CHECK (organization_a_id < organization_b_id),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT ex_agreement_no_overlap EXCLUDE USING gist (
        organization_a_id WITH =,
        organization_b_id WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    )
);

CREATE TABLE facilities (
    id                      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id         integer       NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    region_id               integer       NOT NULL REFERENCES regions (id) ON DELETE RESTRICT,
    code                    text          NOT NULL UNIQUE CHECK (code ~ '^FAC-[0-9]{3,}$'),
    name                    text          NOT NULL,
    facility_type           facility_type NOT NULL,
    address_line            text          NOT NULL,
    latitude                numeric(9,6)  NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
    longitude               numeric(9,6)  NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    has_cold_chain          boolean       NOT NULL DEFAULT false,
    max_dispatch_radius_km  numeric(6,1)  NOT NULL DEFAULT 100 CHECK (max_dispatch_radius_km > 0),
    contact_phone           text,
    is_active               boolean       NOT NULL DEFAULT true,
    is_synthetic            boolean       NOT NULL DEFAULT true,
    created_at              timestamptz   NOT NULL DEFAULT now(),
    updated_at              timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

-- Platform- or organisation-level role grants (SYSTEM_ADMIN, ORG_ADMIN, AUDITOR).
-- organization_id NULL = platform-wide. Level validity vs roles.grant_level is
-- enforced by trigger trg_validate_role_grant (Phase 2) — a CHECK cannot see roles.
CREATE TABLE user_roles (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role_id         smallint    NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    organization_id integer     REFERENCES organizations (id) ON DELETE RESTRICT,
    granted_by      bigint      REFERENCES users (id) ON DELETE RESTRICT,
    granted_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (user_id, role_id, organization_id)
);

-- Facility-level role assignments (FACILITY_MANAGER, INVENTORY_MANAGER).
CREATE TABLE facility_users (
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    facility_id     integer     NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    role_id         smallint    NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    assigned_by     bigint      REFERENCES users (id) ON DELETE RESTRICT,
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, facility_id, role_id)
);

-- =============================================================================
-- 3. Medicine master data
-- =============================================================================

CREATE TABLE medicine_categories (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id       integer REFERENCES medicine_categories (id) ON DELETE RESTRICT,
    name            text    NOT NULL,
    description     text,
    CHECK (parent_id IS NULL OR parent_id <> id),
    UNIQUE NULLS NOT DISTINCT (parent_id, name)
);

CREATE TABLE medicine_units (
    id              smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]+$'),   -- TAB, CAP, VIAL, AMP, BTL ...
    name            text NOT NULL UNIQUE                              -- tablet, capsule, vial ...
);

CREATE TABLE manufacturers (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            text    NOT NULL UNIQUE,
    license_number  text    NOT NULL UNIQUE,
    country         text    NOT NULL DEFAULT 'India',
    is_synthetic    boolean NOT NULL DEFAULT true
);

-- Active pharmaceutical substances (INN), e.g. 'Amoxicillin', 'Lumefantrine'.
CREATE TABLE substances (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 120)
);

-- A medicine is a product definition: designation + dosage form + composition.
-- Strength lives in medicine_ingredients so combination products stay atomic (1NF).
-- Manufacturer belongs to the batch: one medicine is supplied by many manufacturers.
-- Category is product-level (aspirin 75 mg = antiplatelet, 300 mg = analgesic),
-- so it is not determined by the substance.
-- "No two medicines with the same form, volume and ingredient set" cannot be a
-- declarative constraint (set-valued); it is enforced by trigger (Phase 2).
CREATE TABLE medicines (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                text         NOT NULL UNIQUE CHECK (code ~ '^MED-[0-9]{4}$'),
    name                text         NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
    dosage_form         dosage_form  NOT NULL,
    unit_volume_ml      numeric(8,2) CHECK (unit_volume_ml > 0),        -- e.g. 10 mL vial; NULL for solids
    category_id         integer      NOT NULL REFERENCES medicine_categories (id) ON DELETE RESTRICT,
    dispensing_unit_id  smallint     NOT NULL REFERENCES medicine_units (id) ON DELETE RESTRICT,
    requires_cold_chain boolean      NOT NULL DEFAULT false,
    is_essential        boolean      NOT NULL DEFAULT false,
    description         text,
    is_active           boolean      NOT NULL DEFAULT true,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE medicine_ingredients (
    medicine_id     integer       NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    substance_id    integer       NOT NULL REFERENCES substances (id) ON DELETE RESTRICT,
    strength_value  numeric(10,3) NOT NULL CHECK (strength_value > 0),
    strength_uom    text          NOT NULL CHECK (strength_uom IN ('mg', 'mcg', 'g', 'IU', 'mL', '%', 'mg/mL', 'mg/5mL', 'IU/mL', 'mcg/dose', 'g/L')),
    PRIMARY KEY (medicine_id, substance_id)
);

-- A batch is a physical manufacturing lot. It exists once, regardless of how
-- many facilities hold part of it; per-facility quantities live in inventory.
CREATE TABLE medicine_batches (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    medicine_id         integer       NOT NULL REFERENCES medicines (id) ON DELETE RESTRICT,
    manufacturer_id     integer       NOT NULL REFERENCES manufacturers (id) ON DELETE RESTRICT,
    batch_number        text          NOT NULL CHECK (batch_number ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
    manufacture_date    date          NOT NULL,
    expiry_date         date          NOT NULL,
    unit_cost           numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
    status              batch_status  NOT NULL DEFAULT 'ACTIVE',
    status_reason       text,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT ck_batch_dates CHECK (expiry_date > manufacture_date),
    CONSTRAINT ck_batch_status_reason CHECK (status = 'ACTIVE' OR status_reason IS NOT NULL),
    CONSTRAINT uq_batch_lot UNIQUE (manufacturer_id, medicine_id, batch_number)
);

-- =============================================================================
-- 4. Inventory (current balances) and per-facility stock policy
-- =============================================================================

-- Authoritative current balance per (facility, batch). Changed ONLY by the
-- movement-ledger trigger (Phase 2); the application DB role has no UPDATE
-- privilege on this table. Totals per medicine/facility are derived in views.
CREATE TABLE inventory (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_id     integer     NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    batch_id        bigint      NOT NULL REFERENCES medicine_batches (id) ON DELETE RESTRICT,
    qty_available   integer     NOT NULL DEFAULT 0 CONSTRAINT ck_inventory_available_nonneg CHECK (qty_available >= 0),
    qty_reserved    integer     NOT NULL DEFAULT 0 CONSTRAINT ck_inventory_reserved_nonneg  CHECK (qty_reserved  >= 0),
    qty_damaged     integer     NOT NULL DEFAULT 0 CONSTRAINT ck_inventory_damaged_nonneg   CHECK (qty_damaged   >= 0),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_facility_batch UNIQUE (facility_id, batch_id)
);

CREATE TABLE facility_medicine_settings (
    facility_id                 integer       NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    medicine_id                 integer       NOT NULL REFERENCES medicines (id) ON DELETE RESTRICT,
    min_stock_level             integer       NOT NULL CHECK (min_stock_level >= 0),   -- below = CRITICAL
    reorder_threshold           integer       NOT NULL CHECK (reorder_threshold > 0),  -- below = LOW
    safety_stock                integer       NOT NULL CHECK (safety_stock >= 0),
    estimated_daily_consumption numeric(10,2) NOT NULL CHECK (estimated_daily_consumption >= 0),
    estimate_is_simulated       boolean       NOT NULL DEFAULT true,  -- measured demand is derived from DISPENSE movements
    updated_by                  bigint        REFERENCES users (id) ON DELETE RESTRICT,
    updated_at                  timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_id, medicine_id),
    CONSTRAINT ck_settings_min_le_reorder CHECK (min_stock_level <= reorder_threshold),
    CONSTRAINT ck_settings_safety_le_reorder CHECK (safety_stock <= reorder_threshold)
);

-- Single-row, typed configuration for the redistribution engine and alerts.
CREATE TABLE engine_config (
    id                               boolean      PRIMARY KEY DEFAULT true CHECK (id),
    planning_horizon_days            integer      NOT NULL DEFAULT 30  CHECK (planning_horizon_days BETWEEN 1 AND 365),
    min_remaining_shelf_life_days    integer      NOT NULL DEFAULT 14  CHECK (min_remaining_shelf_life_days >= 0),
    near_expiry_window_days          integer      NOT NULL DEFAULT 60  CHECK (near_expiry_window_days BETWEEN 1 AND 365),
    measured_demand_min_history_days integer      NOT NULL DEFAULT 30  CHECK (measured_demand_min_history_days >= 7),
    large_adjustment_audit_units     integer      NOT NULL DEFAULT 500 CHECK (large_adjustment_audit_units > 0),
    updated_by                       bigint       REFERENCES users (id) ON DELETE RESTRICT,
    updated_at                       timestamptz  NOT NULL DEFAULT now()
);

-- =============================================================================
-- 5. Requests, recommendations, transfers
-- =============================================================================

CREATE TABLE stock_requests (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                    text                 NOT NULL UNIQUE CHECK (code ~ '^SR-[0-9]{4}-[0-9]{5}$'),
    requesting_facility_id  integer              NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    requested_by            bigint               NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    priority                request_priority     NOT NULL DEFAULT 'ROUTINE',
    status                  stock_request_status NOT NULL DEFAULT 'OPEN',
    needed_by               date,
    notes                   text,
    created_at              timestamptz          NOT NULL DEFAULT now(),
    updated_at              timestamptz          NOT NULL DEFAULT now(),
    closed_at               timestamptz,
    CHECK ((status = 'OPEN') = (closed_at IS NULL))
);

CREATE TABLE stock_request_items (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stock_request_id    bigint  NOT NULL REFERENCES stock_requests (id) ON DELETE CASCADE,
    medicine_id         integer NOT NULL REFERENCES medicines (id) ON DELETE RESTRICT,
    quantity_requested  integer NOT NULL CHECK (quantity_requested > 0),
    UNIQUE (stock_request_id, medicine_id)          -- one line per medicine; quantity fulfilled is derived from transfers
);

-- Snapshot of an engine suggestion at generation time. The source is an
-- inventory row (which determines facility, batch, medicine and expiry), and
-- distance is derived from facility coordinates, so none of those are stored.
-- projected_shortage_reduction and priority_score are historical facts of the
-- run (stock changes afterwards), so they are not derivable later.
CREATE TABLE redistribution_recommendations (
    id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    generated_at                 timestamptz           NOT NULL DEFAULT now(),
    reason_code                  recommendation_reason NOT NULL,
    source_inventory_id          bigint                NOT NULL REFERENCES inventory (id) ON DELETE RESTRICT,
    destination_facility_id      integer               NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    recommended_quantity         integer               NOT NULL CHECK (recommended_quantity > 0),
    projected_shortage_reduction integer               NOT NULL CHECK (projected_shortage_reduction >= 0),
    priority_score               numeric(5,2)          NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
    explanation                  text                  NOT NULL,
    status                       recommendation_status NOT NULL DEFAULT 'OPEN',
    status_changed_by            bigint                REFERENCES users (id) ON DELETE RESTRICT,
    status_changed_at            timestamptz,
    CHECK (projected_shortage_reduction <= recommended_quantity),
    CHECK ((status = 'OPEN') = (status_changed_at IS NULL))
);

CREATE TABLE transfer_requests (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                     text            NOT NULL UNIQUE CHECK (code ~ '^TRF-[0-9]{4}-[0-9]{5}$'),
    source_facility_id       integer         NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    destination_facility_id  integer         NOT NULL REFERENCES facilities (id) ON DELETE RESTRICT,
    recommendation_id        bigint          UNIQUE REFERENCES redistribution_recommendations (id) ON DELETE RESTRICT,
    status                   transfer_status NOT NULL DEFAULT 'PENDING',
    requested_by             bigint          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    request_notes            text,
    rejection_reason         text,
    created_at               timestamptz     NOT NULL DEFAULT now(),
    updated_at               timestamptz     NOT NULL DEFAULT now(),
    CONSTRAINT ck_transfer_distinct_facilities CHECK (source_facility_id <> destination_facility_id),
    CONSTRAINT ck_transfer_rejection_reason CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);

CREATE TABLE transfer_items (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id                 bigint  NOT NULL REFERENCES transfer_requests (id) ON DELETE CASCADE,
    batch_id                    bigint  NOT NULL REFERENCES medicine_batches (id) ON DELETE RESTRICT,
    quantity                    integer NOT NULL CHECK (quantity > 0),
    quantity_received           integer CHECK (quantity_received >= 0),
    quantity_damaged_in_transit integer CHECK (quantity_damaged_in_transit >= 0),
    CONSTRAINT uq_transfer_item_batch UNIQUE (transfer_id, batch_id),
    CHECK ((quantity_received IS NULL) = (quantity_damaged_in_transit IS NULL)),
    CHECK (quantity_received IS NULL OR quantity_received + quantity_damaged_in_transit = quantity)
);

-- Which transfer item fulfils which stock-request line. An association relation
-- instead of transfer_requests.stock_request_id, which would make the destination
-- depend on a non-key (one request is fulfilled by many transfers).
CREATE TABLE stock_request_fulfilments (
    transfer_item_id        bigint PRIMARY KEY REFERENCES transfer_items (id) ON DELETE CASCADE,
    stock_request_item_id   bigint NOT NULL REFERENCES stock_request_items (id) ON DELETE RESTRICT
);

CREATE TABLE transfer_approvals (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id     bigint            NOT NULL REFERENCES transfer_requests (id) ON DELETE CASCADE,
    stage           approval_stage    NOT NULL,
    decision        approval_decision NOT NULL,
    decided_by      bigint            NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    comment         text,
    decided_at      timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT uq_approval_stage UNIQUE (transfer_id, stage),   -- each stage decided exactly once
    CONSTRAINT ck_approval_rejection_comment CHECK (decision = 'APPROVED' OR comment IS NOT NULL)
);

-- Append-only state history, written by trigger on transfer_requests (Phase 2).
-- The previous status is not stored: it is LAG(to_status) over changed_at.
CREATE TABLE transfer_status_history (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id     bigint          NOT NULL REFERENCES transfer_requests (id) ON DELETE CASCADE,
    to_status       transfer_status NOT NULL,
    changed_by      bigint          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    note            text,
    changed_at      timestamptz     NOT NULL DEFAULT clock_timestamp()
);

-- =============================================================================
-- 6. Movement ledger (append-only)
-- =============================================================================

-- The effect of each movement type on the three inventory buckets is stated
-- ONCE here, not repeated on every ledger row. effect_* ∈ {-1, 0, +1}.
CREATE TABLE movement_types (
    code                    text     PRIMARY KEY CHECK (code ~ '^[A-Z_]+$'),
    effect_available        smallint NOT NULL CHECK (effect_available BETWEEN -1 AND 1),
    effect_reserved         smallint NOT NULL CHECK (effect_reserved  BETWEEN -1 AND 1),
    effect_damaged          smallint NOT NULL CHECK (effect_damaged   BETWEEN -1 AND 1),
    requires_transfer_item  boolean  NOT NULL,
    requires_reason         boolean  NOT NULL,
    description             text     NOT NULL,
    CHECK (effect_available <> 0 OR effect_reserved <> 0 OR effect_damaged <> 0)
);

INSERT INTO movement_types (code, effect_available, effect_reserved, effect_damaged, requires_transfer_item, requires_reason, description) VALUES
    ('RECEIPT',          1,  0,  0, false, false, 'Goods received from a supplier'),
    ('DISPENSE',        -1,  0,  0, false, false, 'Issued to patients / wards (consumption)'),
    ('RESERVE',         -1,  1,  0, true,  false, 'Allocated to an approved transfer'),
    ('RELEASE',          1, -1,  0, true,  false, 'Reservation returned (transfer rejected or cancelled)'),
    ('TRANSFER_OUT',     0, -1,  0, true,  false, 'Reserved stock dispatched to another facility'),
    ('TRANSFER_IN',      1,  0,  0, true,  false, 'Stock received from another facility'),
    ('TRANSIT_DAMAGE',   0,  0,  1, true,  true,  'Received damaged in transit'),
    ('DAMAGE',          -1,  0,  1, false, true,  'Usable stock found damaged'),
    ('DISPOSAL',         0,  0, -1, false, true,  'Damaged stock destroyed'),
    ('EXPIRY_WRITE_OFF',-1,  0,  0, false, true,  'Expired stock removed from usable inventory'),
    ('ADJUSTMENT_IN',    1,  0,  0, false, true,  'Stock-count correction (increase)'),
    ('ADJUSTMENT_OUT',  -1,  0,  0, false, true,  'Stock-count correction (decrease)');

-- Signed bucket deltas = quantity × movement_types.effect_*. The INSERT trigger
-- (Phase 2) applies them to inventory in the same transaction; inventory's
-- CHECK (qty >= 0) then aborts any movement that would go negative.
CREATE TABLE inventory_movements (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventory_id        bigint      NOT NULL REFERENCES inventory (id) ON DELETE RESTRICT,
    movement_type       text        NOT NULL REFERENCES movement_types (code) ON DELETE RESTRICT,
    quantity            integer     NOT NULL CONSTRAINT ck_movement_quantity_positive CHECK (quantity > 0),
    transfer_item_id    bigint      REFERENCES transfer_items (id) ON DELETE RESTRICT,
    reason              text,
    reference           text,
    performed_by        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 7. Alerts, notifications, audit, idempotency
-- =============================================================================

CREATE TABLE expiry_alerts (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventory_id            bigint       NOT NULL REFERENCES inventory (id) ON DELETE RESTRICT,
    level                   expiry_level NOT NULL,
    status                  alert_status NOT NULL DEFAULT 'OPEN',
    quantity_at_detection   integer      NOT NULL CHECK (quantity_at_detection >= 0),
    detected_at             timestamptz  NOT NULL DEFAULT now(),
    acknowledged_by         bigint       REFERENCES users (id) ON DELETE RESTRICT,
    acknowledged_at         timestamptz,
    resolved_at             timestamptz,
    CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)),
    CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE TABLE shortage_alerts (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_id             integer           NOT NULL,
    medicine_id             integer           NOT NULL,
    severity                shortage_severity NOT NULL,
    status                  alert_status      NOT NULL DEFAULT 'OPEN',
    stock_at_detection      integer           NOT NULL CHECK (stock_at_detection >= 0),
    threshold_at_detection  integer           NOT NULL CHECK (threshold_at_detection >= 0),
    detected_at             timestamptz       NOT NULL DEFAULT now(),
    acknowledged_by         bigint            REFERENCES users (id) ON DELETE RESTRICT,
    acknowledged_at         timestamptz,
    resolved_at             timestamptz,
    FOREIGN KEY (facility_id, medicine_id) REFERENCES facility_medicine_settings (facility_id, medicine_id) ON DELETE RESTRICT,
    CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)),
    CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE TABLE notifications (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_user_id   bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category            text        NOT NULL CHECK (category IN ('TRANSFER', 'SHORTAGE', 'EXPIRY', 'RECOMMENDATION', 'SYSTEM')),
    title               text        NOT NULL,
    body                text        NOT NULL,
    entity_type         text,
    entity_id           text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    read_at             timestamptz,
    CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);

-- Append-only: UPDATE/DELETE are blocked by trigger and privilege (Phase 2).
CREATE TABLE audit_logs (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_user_id   bigint      REFERENCES users (id) ON DELETE RESTRICT,   -- NULL = system job
    action          text        NOT NULL CHECK (action ~ '^[A-Z_]+$'),
    entity_type     text        NOT NULL CHECK (entity_type ~ '^[A-Z_]+$'),
    entity_id       text,
    facility_id     integer     REFERENCES facilities (id) ON DELETE RESTRICT,
    old_values      jsonb,
    new_values      jsonb,
    request_id      uuid,
    ip_address      inet
);

-- Exactly-once semantics for retried API calls (create transfer, approve,
-- dispatch, receive, receipt of stock). Same key + different payload = error.
CREATE TABLE idempotency_keys (
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    idem_key        uuid        NOT NULL,
    operation       text        NOT NULL,
    request_hash    text        NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),   -- sha-256 of canonical body
    resource_type   text        NOT NULL,
    resource_id     text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idem_key)
);

-- =============================================================================
-- 8. Indexes (beyond those implied by PRIMARY KEY / UNIQUE)
-- =============================================================================

-- Access control & hierarchy navigation
CREATE INDEX ix_user_roles_org              ON user_roles (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX ix_facility_users_facility     ON facility_users (facility_id);
CREATE INDEX ix_regions_parent              ON regions (parent_id);
CREATE INDEX ix_facilities_org              ON facilities (organization_id);
CREATE INDEX ix_facilities_region           ON facilities (region_id);
CREATE INDEX ix_categories_parent           ON medicine_categories (parent_id);

-- Medicine lookup: substring search on name / substance (ILIKE '%amox%') and by category
CREATE INDEX ix_medicines_name_trgm         ON medicines USING gin (name gin_trgm_ops);
CREATE INDEX ix_substances_name_trgm        ON substances USING gin (name gin_trgm_ops);
CREATE INDEX ix_ingredients_substance       ON medicine_ingredients (substance_id);
CREATE INDEX ix_medicines_category          ON medicines (category_id);
CREATE INDEX ix_manufacturers_name_trgm     ON manufacturers USING gin (name gin_trgm_ops);

-- Batch expiry searches and FEFO ordering
CREATE INDEX ix_batches_medicine_expiry     ON medicine_batches (medicine_id, expiry_date);
CREATE INDEX ix_batches_active_expiry       ON medicine_batches (expiry_date) WHERE status = 'ACTIVE';
CREATE INDEX ix_batches_manufacturer        ON medicine_batches (manufacturer_id);

-- Facility inventory lookup (facility_id leads the UNIQUE index already)
CREATE INDEX ix_inventory_batch             ON inventory (batch_id);
CREATE INDEX ix_inventory_facility_instock  ON inventory (facility_id) INCLUDE (batch_id, qty_available) WHERE qty_available > 0;

-- Movement history: per inventory row, time-ordered analytics, transfer linkage
CREATE INDEX ix_movements_inventory_time    ON inventory_movements (inventory_id, created_at DESC);
CREATE INDEX ix_movements_type_time         ON inventory_movements (movement_type, created_at) INCLUDE (inventory_id, quantity);
CREATE INDEX ix_movements_created_brin      ON inventory_movements USING brin (created_at);
CREATE INDEX ix_movements_transfer_item     ON inventory_movements (transfer_item_id) WHERE transfer_item_id IS NOT NULL;

-- Transfers by status and by facility
CREATE INDEX ix_transfers_status_created    ON transfer_requests (status, created_at DESC);
CREATE INDEX ix_transfers_source_status     ON transfer_requests (source_facility_id, status);
CREATE INDEX ix_transfers_dest_status       ON transfer_requests (destination_facility_id, status);
CREATE INDEX ix_transfer_items_batch        ON transfer_items (batch_id);
CREATE INDEX ix_fulfilments_request_item    ON stock_request_fulfilments (stock_request_item_id);
CREATE INDEX ix_transfer_history_transfer   ON transfer_status_history (transfer_id, changed_at);

-- Requests & recommendations
CREATE INDEX ix_stock_requests_facility     ON stock_requests (requesting_facility_id, status);
CREATE INDEX ix_stock_request_items_med     ON stock_request_items (medicine_id);
CREATE UNIQUE INDEX ux_reco_open_route      ON redistribution_recommendations (source_inventory_id, destination_facility_id) WHERE status = 'OPEN';
CREATE INDEX ix_reco_destination            ON redistribution_recommendations (destination_facility_id);
CREATE INDEX ix_reco_open_priority          ON redistribution_recommendations (priority_score DESC) WHERE status = 'OPEN';

-- Alerts: at most one unresolved alert per subject
CREATE UNIQUE INDEX ux_expiry_alert_open    ON expiry_alerts (inventory_id, level) WHERE status <> 'RESOLVED';
CREATE UNIQUE INDEX ux_shortage_alert_open  ON shortage_alerts (facility_id, medicine_id) WHERE status <> 'RESOLVED';
CREATE INDEX ix_shortage_alerts_medicine    ON shortage_alerts (medicine_id);

-- Notifications inbox & audit search
CREATE INDEX ix_notifications_unread        ON notifications (recipient_user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX ix_audit_entity                ON audit_logs (entity_type, entity_id);
CREATE INDEX ix_audit_actor_time            ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX ix_audit_facility_time         ON audit_logs (facility_id, occurred_at DESC) WHERE facility_id IS NOT NULL;
CREATE INDEX ix_audit_occurred_brin         ON audit_logs USING brin (occurred_at);

-- =============================================================================
-- 9. Human-readable code sequences
-- =============================================================================
CREATE SEQUENCE transfer_code_seq      START 1;
CREATE SEQUENCE stock_request_code_seq START 1;

-- =============================================================================
-- 10. In-database data dictionary
-- =============================================================================
COMMENT ON TABLE users                          IS 'Platform accounts. Deactivated (is_active=false), never deleted, so history keeps its actors.';
COMMENT ON TABLE roles                          IS 'The five MedShare roles; grant_level states where each may be granted.';
COMMENT ON TABLE permissions                    IS 'Fine-grained actions checked by fn_user_has_permission().';
COMMENT ON TABLE role_permissions               IS 'RBAC matrix as data (role × permission).';
COMMENT ON TABLE user_roles                     IS 'Platform (organization_id NULL) or organisation-level role grants.';
COMMENT ON TABLE facility_users                 IS 'Facility-level role assignments (FACILITY_MANAGER, INVENTORY_MANAGER).';
COMMENT ON TABLE regions                        IS 'State > district > taluk tree. Level = depth, derived by recursive CTE (v_region_tree).';
COMMENT ON TABLE organizations                  IS 'Participating institutions (synthetic).';
COMMENT ON TABLE organization_agreements        IS 'Authorises cross-organisation transfers for a validity period; overlap prevented by exclusion constraint.';
COMMENT ON TABLE facilities                     IS 'Inventory-holding sites with coordinates, cold-chain capability and dispatch radius.';
COMMENT ON TABLE medicine_categories            IS 'Hierarchical therapeutic classification (acyclic, enforced by trigger).';
COMMENT ON TABLE medicine_units                 IS 'Issue units (tablet, vial, bottle…).';
COMMENT ON TABLE substances                     IS 'Active pharmaceutical substances (INN).';
COMMENT ON TABLE medicines                      IS 'Product definition: designation + dosage form + composition (medicine_ingredients).';
COMMENT ON TABLE medicine_ingredients           IS 'Composition: strength per (medicine, substance). Keeps combination products in 1NF.';
COMMENT ON TABLE manufacturers                  IS 'Batch manufacturers (synthetic).';
COMMENT ON TABLE medicine_batches               IS 'Physical manufacturing lot. Exists once; per-facility quantities are in inventory. Expired = derived from expiry_date.';
COMMENT ON TABLE inventory                      IS 'Current balance per (facility, batch). Changed ONLY by the inventory_movements ledger trigger.';
COMMENT ON TABLE facility_medicine_settings     IS 'Per-site stock policy and demand estimate (estimate_is_simulated labels synthetic estimates).';
COMMENT ON TABLE engine_config                  IS 'Single-row configuration for the redistribution engine and alerting.';
COMMENT ON TABLE movement_types                 IS 'Effect of each movement type on the three inventory buckets, stated once.';
COMMENT ON TABLE inventory_movements            IS 'Append-only stock ledger. Balance delta = quantity × movement_types.effect_*.';
COMMENT ON TABLE stock_requests                 IS 'Destination demand (header). Fulfilment is derived from stock_request_fulfilments.';
COMMENT ON TABLE stock_request_items            IS 'Requested medicine quantities (one line per medicine).';
COMMENT ON TABLE redistribution_recommendations IS 'Engine output snapshot. Advisory only — never executes a transfer.';
COMMENT ON TABLE transfer_requests              IS 'Transfer header; status is the lock target for the workflow procedures.';
COMMENT ON TABLE transfer_items                 IS 'Batch-level transfer lines with received / damaged-in-transit quantities.';
COMMENT ON TABLE stock_request_fulfilments      IS 'Which transfer line fulfils which stock-request line.';
COMMENT ON TABLE transfer_approvals             IS 'One decision per approval stage (append-only).';
COMMENT ON TABLE transfer_status_history        IS 'Append-only lifecycle, written by trigger. Previous status = LAG(to_status).';
COMMENT ON TABLE expiry_alerts                  IS 'Expiry monitoring alerts; at most one unresolved per (inventory, level).';
COMMENT ON TABLE shortage_alerts                IS 'Shortage alerts maintained by trigger; at most one unresolved per (facility, medicine).';
COMMENT ON TABLE notifications                  IS 'In-app notifications per user.';
COMMENT ON TABLE audit_logs                     IS 'Append-only audit trail (UPDATE/DELETE blocked by trigger and privilege).';
COMMENT ON TABLE idempotency_keys               IS 'Exactly-once semantics for retried API operations.';

COMMENT ON COLUMN inventory.qty_available       IS 'Units free to allocate (not reserved, not damaged).';
COMMENT ON COLUMN inventory.qty_reserved        IS 'Units allocated to APPROVED, not yet dispatched transfers.';
COMMENT ON COLUMN inventory.qty_damaged         IS 'Units physically held but unusable, awaiting disposal.';
COMMENT ON COLUMN medicine_batches.status       IS 'Administrative status only. Expiry is derived from expiry_date, never stored.';
COMMENT ON COLUMN facility_medicine_settings.min_stock_level IS 'Below this usable quantity the shortage is CRITICAL.';
COMMENT ON COLUMN facility_medicine_settings.reorder_threshold IS 'Below this usable quantity the shortage is LOW.';
COMMENT ON COLUMN facility_medicine_settings.estimated_daily_consumption IS 'Configured/simulated estimate. Measured demand is derived from DISPENSE movements (v_demand).';
COMMENT ON COLUMN redistribution_recommendations.projected_shortage_reduction IS 'Units of destination deficit this recommendation would cover, at generation time.';
COMMENT ON COLUMN inventory_movements.quantity  IS 'Always positive; direction comes from movement_types.';
COMMENT ON COLUMN audit_logs.actor_user_id      IS 'NULL when the action was performed by a scheduled system job.';
