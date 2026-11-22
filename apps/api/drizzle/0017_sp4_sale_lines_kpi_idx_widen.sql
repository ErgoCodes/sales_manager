-- Custom migration (SP4·T6): widen the covering KPI index of 0016 with product_id and quantity, so the
-- product ranking (top-products) is an index-only scan like the other sale_lines aggregates, for the
-- dashboard windows up to 30 days at 10× the demo volume (ADR 0007, "Resultados medidos"; the owner
-- chose this option on 2026-11-22). Runs as monaco_owner. Policies, FORCE ROW LEVEL SECURITY and
-- grants are untouched. Hand-written because drizzle-kit does not model INCLUDE.
DROP INDEX "sale_lines_kpi_idx";--> statement-breakpoint
CREATE INDEX "sale_lines_kpi_idx" ON "sale_lines" USING btree ("tenant_id","location_id","occurred_at") INCLUDE ("currency","payment_method","line_total","profit","sale_id","product_id","quantity");
