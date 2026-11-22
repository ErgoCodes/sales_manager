-- Custom migration (SP4·T3, D4): the SP3·D11 procedure for reports:view_own. In the SYSTEM roles
-- of every existing tenant it grants reports:view_own to Owner (it holds every permission),
-- Manager (a subset of its reports:view, needed by the no-escalation rule so it can still assign
-- and manage Cashiers) and Cashier, and REMOVES reports:view from the system Cashier (its "own
-- close" replaces it). Runs
-- as monaco_owner, inside the single transaction of the migrator, so a failure rolls back the
-- NO FORCE below as well.
--
-- Why NO FORCE: under FORCE ROW LEVEL SECURITY the owner sees no rows without a tenant
-- context (ADR 0003), so it cannot enumerate tenants. The owner already controls RLS on these
-- tables (ADR 0003 §8); the toggle is transactional and FORCE is restored before commit.
--
-- Idempotent and re-runnable: only missing rows are inserted (ON CONFLICT DO NOTHING) and the
-- delete matches nothing the second time. If it runs before the new code is deployed, a tenant
-- created afterwards by the old ensureSystemRoles has the old Cashier and this file can simply
-- be run again.
--
-- Never touches custom roles: both statements require is_system and a system key, so a custom
-- role with reports:view keeps it. Nobody loses a feature: there were no reports before SP4.
-- Mirror of SYSTEM_ROLES (apps/api/src/modules/iam/domain/system-roles.ts); an integration
-- test fails if the data this produces differs from it.

ALTER TABLE "roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r."id", g."permission", r."tenant_id"
FROM "roles" r
JOIN (VALUES
  ('owner', 'reports:view_own'),
  ('manager', 'reports:view_own'),
  ('cashier', 'reports:view_own')
) AS g ("key", "permission") ON g."key" = r."key"
WHERE r."is_system" = true
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "role_permissions" rp
USING "roles" r
WHERE rp."role_id" = r."id"
  AND rp."tenant_id" = r."tenant_id"
  AND r."is_system" = true
  AND r."key" = 'cashier'
  AND rp."permission" = 'reports:view';--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
