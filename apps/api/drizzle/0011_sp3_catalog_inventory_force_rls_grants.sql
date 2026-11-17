-- Custom migration (SP3·T3): FORCE ROW LEVEL SECURITY, privileges of monaco_app and the covering
-- index of the stock sum for the four catalog/inventory tables created in 0010. Runs as
-- monaco_owner. Does not touch existing tables, policies or grants.
-- 1. FORCE ROW LEVEL SECURITY: the policies also bind the table owner (ADR 0003).
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- 2. Privileges. Products are archived and location_products rows are permanent (the lock of the
--    pair), so neither gets DELETE. The ledger is append-only (ADR 0006): INSERT and SELECT only.
--    The default privileges of monaco_owner grant all four DML privileges, so revoke first (as 0004).
REVOKE ALL ON "products", "location_products", "inventory_documents", "inventory_movements" FROM monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "products", "location_products" TO monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "inventory_documents", "inventory_movements" TO monaco_app;--> statement-breakpoint
-- 3. Covering index for the stock of a location: GROUP BY product_id is an index-only scan.
--    Hand-written because drizzle-kit does not model INCLUDE.
CREATE INDEX "inventory_movements_stock_sum_idx" ON "inventory_movements" USING btree ("tenant_id","location_id","product_id") INCLUDE ("quantity_delta");
