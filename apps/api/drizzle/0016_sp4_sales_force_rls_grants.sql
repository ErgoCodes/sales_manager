-- Custom migration (SP4·T4): FORCE ROW LEVEL SECURITY, privileges of monaco_app and the covering
-- KPI index for the two sales tables created in 0015. Runs as monaco_owner. Does not touch existing
-- tables, policies or grants: the new tenants columns (time_zone, read_only) get no column grant, so
-- monaco_app keeps UPDATE on tenants.name only (0006).
-- 1. FORCE ROW LEVEL SECURITY: the policies also bind the table owner (ADR 0003).
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- 2. Privileges. Sales are append-only like the ledger (ADR 0006, SP4 spec): INSERT and SELECT only.
--    The default privileges of monaco_owner grant all four DML privileges, so revoke first (as 0011).
REVOKE ALL ON "sales", "sale_lines" FROM monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "sales", "sale_lines" TO monaco_app;--> statement-breakpoint
-- 3. Covering index of the KPIs: totals by currency and payment method of a location and range are an
--    index-only scan. Hand-written because drizzle-kit does not model INCLUDE.
CREATE INDEX "sale_lines_kpi_idx" ON "sale_lines" USING btree ("tenant_id","location_id","occurred_at") INCLUDE ("currency","payment_method","line_total","profit","sale_id");
