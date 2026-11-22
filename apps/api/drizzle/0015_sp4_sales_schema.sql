CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"cashier_user_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"is_cost_sale" boolean NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"line_total" bigint NOT NULL,
	"profit" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_lines_currency_check" CHECK (currency in ('CUP', 'USD', 'MLC')),
	CONSTRAINT "sale_lines_payment_method_check" CHECK (payment_method in ('cash', 'transfer')),
	CONSTRAINT "sale_lines_quantity_check" CHECK ("sale_lines"."quantity" > 0),
	CONSTRAINT "sale_lines_unit_price_check" CHECK ("sale_lines"."unit_price" >= 0),
	CONSTRAINT "sale_lines_discount_percent_check" CHECK ("sale_lines"."discount_percent" between 0 and 100),
	CONSTRAINT "sale_lines_unit_cost_check" CHECK ("sale_lines"."unit_cost" >= 0),
	CONSTRAINT "sale_lines_line_total_check" CHECK ("sale_lines"."line_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"cashier_user_id" uuid NOT NULL,
	"device_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "sales_id_tenant_id_location_id_occurred_at_cashier_unique" UNIQUE("id","tenant_id","location_id","occurred_at","cashier_user_id")
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "time_zone" text DEFAULT 'America/Havana' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Moved by hand before the FKs: sales_document_fk references this UNIQUE.
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_id_tenant_id_location_id_occurred_at_unique" UNIQUE("id","tenant_id","location_id","occurred_at");--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_fk" FOREIGN KEY ("sale_id","tenant_id","location_id","occurred_at","cashier_user_id") REFERENCES "public"."sales"("id","tenant_id","location_id","occurred_at","cashier_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_location_product_fk" FOREIGN KEY ("tenant_id","location_id","product_id") REFERENCES "public"."location_products"("tenant_id","location_id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_document_fk" FOREIGN KEY ("id","tenant_id","location_id","occurred_at") REFERENCES "public"."inventory_documents"("id","tenant_id","location_id","occurred_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_user_fk" FOREIGN KEY ("cashier_user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_fk" FOREIGN KEY ("device_id","tenant_id") REFERENCES "public"."devices"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_lines_tenant_id_location_id_product_id_occurred_at_idx" ON "sale_lines" USING btree ("tenant_id","location_id","product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_documents_tenant_id_location_id_occurred_at_idx" ON "inventory_documents" USING btree ("tenant_id","location_id","occurred_at") WHERE "inventory_documents"."kind" in ('exit', 'entry');--> statement-breakpoint
CREATE POLICY "sale_lines_tenant_isolation" ON "sale_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sales_tenant_isolation" ON "sales" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);