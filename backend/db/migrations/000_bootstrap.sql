-- 000 — bootstrap (runs as superuser, idempotent, re-run on every migrate)
-- Creates the three database roles and hands the public schema to the owner.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medshare_owner') THEN
        CREATE ROLE medshare_owner NOLOGIN;            -- owns every object; never used by the API
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medshare_app') THEN
        CREATE ROLE medshare_app LOGIN;                -- API connection; least privilege
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medshare_readonly') THEN
        CREATE ROLE medshare_readonly NOLOGIN;         -- reporting / auditor tooling: views only
    END IF;
END $$;

-- The admin session must be able to SET ROLE medshare_owner.
DO $$ BEGIN EXECUTE format('GRANT medshare_owner TO %I', current_user); END $$;

ALTER SCHEMA public OWNER TO medshare_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO medshare_app, medshare_readonly;
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO medshare_owner', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Kolkata'); END $$;

-- Functions are not executable by PUBLIC unless explicitly granted (006_privileges).
ALTER DEFAULT PRIVILEGES FOR ROLE medshare_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
