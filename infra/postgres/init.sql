-- Roles and privileges for the Monaco database (ADR 0003). Runs once, as the
-- bootstrap superuser, against the current database (docker-entrypoint-initdb.d
-- locally; the integration tests apply it to their own container).
-- Passwords are development-only. Production roles are provisioned in SP4.

-- Schema owner: owns the tables and runs migrations. Not a superuser and not
-- BYPASSRLS, so FORCE ROW LEVEL SECURITY also applies to it.
CREATE ROLE monaco_owner LOGIN PASSWORD 'monaco_owner'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Runtime role of the API: data access only, always subject to RLS.
CREATE ROLE monaco_app LOGIN PASSWORD 'monaco_app'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

DO $$
BEGIN
  -- The database name differs between Compose (monaco) and test containers.
  EXECUTE format('ALTER DATABASE %I OWNER TO monaco_owner', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO monaco_app', current_database());
END
$$;

-- Only the owner creates objects in public; the app can only use them.
ALTER SCHEMA public OWNER TO monaco_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO monaco_app;

-- Tables and sequences that migrations create later (always as monaco_owner)
-- get DML grants for the app automatically. No TRUNCATE, REFERENCES or
-- TRIGGER: TRUNCATE is not subject to RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE monaco_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO monaco_app;
ALTER DEFAULT PRIVILEGES FOR ROLE monaco_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO monaco_app;
