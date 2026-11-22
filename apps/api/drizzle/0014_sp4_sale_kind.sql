ALTER TABLE "inventory_documents" DROP CONSTRAINT "inventory_documents_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_sign_check";--> statement-breakpoint
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_kind_check" CHECK (kind in ('entry', 'exit', 'adjustment', 'transfer', 'reversal', 'sale'));--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind_check" CHECK (kind in ('entry', 'shrinkage', 'owner_withdrawal', 'adjustment', 'transfer_out', 'transfer_in', 'reversal', 'sale'));--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_sign_check" CHECK (case "inventory_movements"."kind"
        when 'entry' then "inventory_movements"."quantity_delta" > 0
        when 'transfer_in' then "inventory_movements"."quantity_delta" > 0
        when 'shrinkage' then "inventory_movements"."quantity_delta" < 0
        when 'owner_withdrawal' then "inventory_movements"."quantity_delta" < 0
        when 'transfer_out' then "inventory_movements"."quantity_delta" < 0
        when 'sale' then "inventory_movements"."quantity_delta" < 0
        else true
      end);