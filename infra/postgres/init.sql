-- Roles and privileges for the Monaco database (ADR 0003). Runs as the
-- bootstrap superuser against the current database (docker-entrypoint-initdb.d
-- locally; the integration tests apply it to their own container).
-- Idempotent: on a database created before a change here (e.g. the SP1 volume,
-- which has no monaco_auth), run it again as superuser:
--   docker compose -f infra/docker-compose.yml exec -T postgres \
--     psql -U postgres -d monaco -v ON_ERROR_STOP=1 < infra/postgres/init.sql
-- Passwords are development-only. Production roles are provisioned in SP4.

DO $$
BEGIN
  -- Schema owner: owns the tables and runs migrations. Not a superuser and not
  -- BYPASSRLS, so FORCE ROW LEVEL SECURITY also applies to it.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monaco_owner') THEN
    CREATE ROLE monaco_owner LOGIN PASSWORD 'monaco_owner';
  END IF;
  ALTER ROLE monaco_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

  -- Runtime role of the API: data access only, always subject to RLS.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monaco_app') THEN
    CREATE ROLE monaco_app LOGIN PASSWORD 'monaco_app';
  END IF;
  ALTER ROLE monaco_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

  -- Owner of the pre-authentication SECURITY DEFINER functions (SP2,
  -- auth_lookup_user / auth_lookup_refresh). It cannot log in, and it only gets
  -- SELECT on the columns those functions read (granted by the migrations).
  -- BYPASSRLS is what lets the functions find a row before any tenant is known.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monaco_auth') THEN
    CREATE ROLE monaco_auth NOLOGIN;
  END IF;
  ALTER ROLE monaco_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;
END
$$;

-- The migrations (run as monaco_owner) create those functions with
-- SET ROLE monaco_auth, so the owner needs SET on monaco_auth, but not
-- INHERIT: it never holds monaco_auth's privileges implicitly. This gives the
-- owner nothing it lacks already (as table owner it can disable RLS anyway);
-- monaco_app is never a member (ADR 0003).
GRANT monaco_auth TO monaco_owner WITH INHERIT FALSE, SET TRUE;

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
-- TRIGGER: TRUNCATE is not subject to RLS. Each migration then narrows the
-- DML per table where the app needs less (e.g. audit_events: INSERT, SELECT).
ALTER DEFAULT PRIVILEGES FOR ROLE monaco_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO monaco_app;
ALTER DEFAULT PRIVILEGES FOR ROLE monaco_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO monaco_app;
