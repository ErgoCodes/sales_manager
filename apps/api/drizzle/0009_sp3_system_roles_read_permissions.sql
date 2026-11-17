-- Custom migration (SP3·T2, D11): backfill the SP3 permissions (catalog:view, inventory:view)
-- into the SYSTEM roles of every existing tenant. Runs as monaco_owner, inside the single
-- transaction of the migrator, so a failure rolls back the NO FORCE below as well.
--
-- Why NO FORCE: under FORCE ROW LEVEL SECURITY the owner sees no rows without a tenant
-- context (ADR 0003), so it cannot enumerate tenants. The owner already controls RLS on these
-- tables (ADR 0003 §8); the toggle is transactional and FORCE is restored before commit.
--
-- Idempotent and re-runnable: only missing rows are inserted (ON CONFLICT DO NOTHING). If it
-- runs before the new code is deployed, a tenant created afterwards by the old
-- ensureSystemRoles lacks these rows and this statement can simply be run again.
--
-- Never grants anything to custom roles: the join requires is_system and a system key.
-- Mirror of SYSTEM_ROLES (apps/api/src/modules/iam/domain/system-roles.ts); an integration
-- test fails if the data this produces differs from it.

ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r."id", g."permission", r."tenant_id"
FROM "roles" r
JOIN (VALUES
  ('owner', 'catalog:view'),
  ('owner', 'inventory:view'),
  ('manager', 'catalog:view'),
  ('manager', 'inventory:view'),
  ('cashier', 'catalog:view'),
  ('cashier', 'inventory:view')
) AS g ("key", "permission") ON g."key" = r."key"
WHERE r."is_system" = true
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
