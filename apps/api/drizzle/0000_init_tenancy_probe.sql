CREATE TABLE "_tenancy_probe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "_tenancy_probe" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "_tenancy_probe_tenant_id_idx" ON "_tenancy_probe" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "_tenancy_probe_tenant_isolation" ON "_tenancy_probe" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);