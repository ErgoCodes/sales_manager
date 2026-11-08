CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"strikes" integer DEFAULT 0 NOT NULL,
	"strikes_expire_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_check";--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK (permission in ('tenant:manage', 'locations:manage', 'users:manage', 'roles:manage', 'devices:manage', 'audit:view', 'catalog:write', 'inventory:write', 'inventory:transfer', 'sales:create', 'sales:void', 'reports:view', 'cash:close'));