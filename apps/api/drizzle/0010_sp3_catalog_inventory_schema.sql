CREATE TABLE "location_products" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"cash_price_override" bigint,
	"transfer_price_override" bigint,
	"average_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_products_pkey" PRIMARY KEY("tenant_id","location_id","product_id"),
	CONSTRAINT "location_products_cash_price_override_check" CHECK ("location_products"."cash_price_override" >= 0),
	CONSTRAINT "location_products_transfer_price_override_check" CHECK ("location_products"."transfer_price_override" >= 0),
	CONSTRAINT "location_products_average_cost_check" CHECK ("location_products"."average_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "location_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_of_measure" text NOT NULL,
	"category" text,
	"currency" text NOT NULL,
	"cost_price" bigint,
	"cash_price" bigint,
	"transfer_price" bigint,
	"low_stock_threshold" numeric(14, 3),
	"expiration_date" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "products_unit_of_measure_check" CHECK (unit_of_measure in ('ud', 'kg', 'litro', 'caja')),
	CONSTRAINT "products_category_check" CHECK (category in ('Bebidas', 'Granos', 'Lácteos', 'Cárnicos', 'Limpieza', 'Aseo personal', 'Snacks', 'Otros')),
	CONSTRAINT "products_currency_check" CHECK (currency in ('CUP', 'USD', 'MLC')),
	CONSTRAINT "products_cost_price_check" CHECK ("products"."cost_price" >= 0),
	CONSTRAINT "products_cash_price_check" CHECK ("products"."cash_price" >= 0),
	CONSTRAINT "products_transfer_price_check" CHECK ("products"."transfer_price" >= 0),
	CONSTRAINT "products_low_stock_threshold_check" CHECK ("products"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"location_id" uuid NOT NULL,
	"target_location_id" uuid,
	"reason" text,
	"reverses_document_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"payload_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_documents_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "inventory_documents_tenant_id_reverses_document_id_unique" UNIQUE("tenant_id","reverses_document_id"),
	CONSTRAINT "inventory_documents_kind_check" CHECK (kind in ('entry', 'exit', 'adjustment', 'transfer', 'reversal')),
	CONSTRAINT "inventory_documents_reason_check" CHECK (reason in ('shrinkage', 'owner_withdrawal')),
	CONSTRAINT "inventory_documents_reason_shape_check" CHECK (("inventory_documents"."kind" = 'exit') = ("inventory_documents"."reason" is not null)),
	CONSTRAINT "inventory_documents_target_shape_check" CHECK (("inventory_documents"."kind" = 'transfer') = ("inventory_documents"."target_location_id" is not null)),
	CONSTRAINT "inventory_documents_target_differs_check" CHECK ("inventory_documents"."target_location_id" is null or "inventory_documents"."target_location_id" <> "inventory_documents"."location_id"),
	CONSTRAINT "inventory_documents_reverses_shape_check" CHECK (("inventory_documents"."kind" = 'reversal') = ("inventory_documents"."reverses_document_id" is not null)),
	CONSTRAINT "inventory_documents_notes_length_check" CHECK (char_length(notes) <= 500)
);
--> statement-breakpoint
ALTER TABLE "inventory_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity_delta" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"reverses_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_id_tenant_id_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "inventory_movements_kind_check" CHECK (kind in ('entry', 'shrinkage', 'owner_withdrawal', 'adjustment', 'transfer_out', 'transfer_in', 'reversal')),
	CONSTRAINT "inventory_movements_quantity_delta_check" CHECK ("inventory_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_movements_sign_check" CHECK (case "inventory_movements"."kind"
        when 'entry' then "inventory_movements"."quantity_delta" > 0
        when 'transfer_in' then "inventory_movements"."quantity_delta" > 0
        when 'shrinkage' then "inventory_movements"."quantity_delta" < 0
        when 'owner_withdrawal' then "inventory_movements"."quantity_delta" < 0
        when 'transfer_out' then "inventory_movements"."quantity_delta" < 0
        else true
      end),
	CONSTRAINT "inventory_movements_unit_cost_check" CHECK ("inventory_movements"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_products" ADD CONSTRAINT "location_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_products" ADD CONSTRAINT "location_products_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_products" ADD CONSTRAINT "location_products_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_location_fk" FOREIGN KEY ("location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_target_location_fk" FOREIGN KEY ("target_location_id","tenant_id") REFERENCES "public"."locations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_created_by_fk" FOREIGN KEY ("created_by","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_reverses_fk" FOREIGN KEY ("reverses_document_id","tenant_id") REFERENCES "public"."inventory_documents"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_document_fk" FOREIGN KEY ("document_id","tenant_id") REFERENCES "public"."inventory_documents"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_product_fk" FOREIGN KEY ("tenant_id","location_id","product_id") REFERENCES "public"."location_products"("tenant_id","location_id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reverses_fk" FOREIGN KEY ("reverses_movement_id","tenant_id") REFERENCES "public"."inventory_movements"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_products_tenant_id_product_id_idx" ON "location_products" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "products_tenant_id_lower_name_idx" ON "products" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "products_tenant_id_archived_at_idx" ON "products" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "inventory_documents_tenant_id_location_id_created_at_id_idx" ON "inventory_documents" USING btree ("tenant_id","location_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_id_document_id_idx" ON "inventory_movements" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE POLICY "location_products_tenant_isolation" ON "location_products" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_documents_tenant_isolation" ON "inventory_documents" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_movements_tenant_isolation" ON "inventory_movements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);