-- Custom migration (SP2·T1): what the IAM tables and functions need before
-- drizzle-kit's generated DDL runs.
--
-- citext is a trusted extension: the database owner (monaco_owner) can create it.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;--> statement-breakpoint
-- monaco_auth (NOLOGIN BYPASSRLS) owns the pre-authentication SECURITY DEFINER
-- functions created in 0004. Creating a BYPASSRLS role needs a superuser, and
-- monaco_owner is NOCREATEROLE on purpose, so this migration cannot create it:
-- infra/postgres/init.sql does (idempotently). On a database bootstrapped
-- before SP2, re-run init.sql as superuser; this check fails loudly until then
-- instead of half-applying the schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monaco_auth') THEN
    RAISE EXCEPTION 'role monaco_auth is missing: run infra/postgres/init.sql as superuser (ADR 0003)';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monaco_auth' AND NOT rolcanlogin AND rolbypassrls AND NOT rolsuper) THEN
    RAISE EXCEPTION 'role monaco_auth must be NOLOGIN BYPASSRLS NOSUPERUSER: run infra/postgres/init.sql as superuser (ADR 0003)';
  END IF;
  IF NOT pg_has_role(current_user, 'monaco_auth', 'SET') THEN
    RAISE EXCEPTION '% cannot SET ROLE monaco_auth: run infra/postgres/init.sql as superuser (ADR 0003)', current_user;
  END IF;
  IF pg_has_role('monaco_app', 'monaco_auth', 'MEMBER') THEN
    RAISE EXCEPTION 'monaco_app must not be a member of monaco_auth (ADR 0003)';
  END IF;
END
$$;
