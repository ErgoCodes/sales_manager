-- Custom migration (SP2·T1): what drizzle-kit does not model (ADR 0003).

-- 1. FORCE ROW LEVEL SECURITY: the policies also bind the table owner.
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_assignment_locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. monaco_app DML, table by table (the default privileges grant all four).
-- Rows that other data hangs off are disabled, archived or revoked, never
-- deleted; tenants are created by the CLI as owner; audit_events is
-- append-only. UPDATE on tenants is what `SELECT ... FOR UPDATE` (the
-- per-tenant mutex of the owner invariant) needs.
REVOKE ALL ON "tenants", "locations", "users", "roles", "role_permissions", "role_assignments",
  "role_assignment_locations", "devices", "refresh_tokens", "audit_events" FROM monaco_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON "tenants" TO monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "locations", "users", "devices", "refresh_tokens" TO monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "roles", "role_permissions", "role_assignments", "role_assignment_locations" TO monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_events" TO monaco_app;--> statement-breakpoint

-- 3. Pre-authentication lookups (SP2 spec): before login or refresh there is no
-- tenant, and FORCE RLS hides every row. These two SECURITY DEFINER functions
-- are the only door: owned by monaco_auth (NOLOGIN BYPASSRLS), which can read
-- just the columns they return; exact equality (no LIKE), at most one row,
-- fixed search_path, EXECUTE only for monaco_app.
GRANT USAGE ON SCHEMA public TO monaco_auth;--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "email", "password_hash", "status") ON "users" TO monaco_auth;--> statement-breakpoint
GRANT SELECT ("tenant_id", "device_id", "family_id", "token_hash", "expires_at", "absolute_expires_at", "rotated_at", "revoked_at")
  ON "refresh_tokens" TO monaco_auth;--> statement-breakpoint
-- The functions are created as monaco_auth so it owns them; it needs CREATE on
-- public only for these statements (init.sql lets monaco_owner SET ROLE to it).
GRANT CREATE ON SCHEMA public TO monaco_auth;--> statement-breakpoint
SET ROLE monaco_auth;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.auth_lookup_user(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, password_hash text, status text)
  LANGUAGE sql STABLE STRICT SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.status
  FROM public.users AS u
  WHERE u.email = p_email::public.citext
  LIMIT 1
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.auth_lookup_refresh(p_token_hash bytea)
  RETURNS TABLE (
    tenant_id uuid, device_id uuid, family_id uuid,
    expires_at timestamptz, absolute_expires_at timestamptz, rotated_at timestamptz, revoked_at timestamptz
  )
  LANGUAGE sql STABLE STRICT SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT r.tenant_id, r.device_id, r.family_id, r.expires_at, r.absolute_expires_at, r.rotated_at, r.revoked_at
  FROM public.refresh_tokens AS r
  WHERE r.token_hash = p_token_hash
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.auth_lookup_user(text), public.auth_lookup_refresh(bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_lookup_user(text), public.auth_lookup_refresh(bytea) TO monaco_app;--> statement-breakpoint
RESET ROLE;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM monaco_auth;
