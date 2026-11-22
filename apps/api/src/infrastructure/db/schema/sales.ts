import { CURRENCIES } from '@monaco/contracts';
import { PAYMENT_METHODS } from '@monaco/domain';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { locationProducts } from './catalog';
import { oneOf } from './checks';
import { devices, users } from './iam';
import { inventoryDocuments } from './inventory';
import { locations, tenantRef } from './tenants';
import { tenantIsolationPolicy } from './tenancy';
import { createdAt, primaryId } from './types';

/*
 * Sales (SP4 spec, "Ventas en el servidor"; ADR 0007). Every sale is also an
 * inventory document of kind `sale` with the same id, and its stock leaves by
 * `sale` movements written with the ADR 0006 script. Append-only like the
 * ledger: monaco_app only has INSERT and SELECT (migration 0016). Amounts are
 * minor units; the line amounts come from saleLineAmounts in @monaco/domain and
 * the CHECKs are defence in depth, not the rule.
 */

/** A sale header. `id` comes from the client and is the id of its `sale` document. */
export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantRef(),
    locationId: uuid('location_id').notNull(),
    cashierUserId: uuid('cashier_user_id').notNull(),
    // Null in SP4 (the seed has no device); SP5 sets it when mobile pushes a sale.
    deviceId: uuid('device_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // SHA-256 of the body as the client sent it (idempotency, like inventory_documents).
    payloadHash: text('payload_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sales_id_tenant_id_unique').on(t.id, t.tenantId),
    // Target of sale_lines_sale_fk: the copies in each line must equal the header.
    unique('sales_id_tenant_id_location_id_occurred_at_cashier_unique').on(t.id, t.tenantId, t.locationId, t.occurredAt, t.cashierUserId),
    // The sale is its document: same id, tenant, location and instant.
    foreignKey({
      name: 'sales_document_fk',
      columns: [t.id, t.tenantId, t.locationId, t.occurredAt],
      foreignColumns: [inventoryDocuments.id, inventoryDocuments.tenantId, inventoryDocuments.locationId, inventoryDocuments.occurredAt],
    }),
    foreignKey({ name: 'sales_location_fk', columns: [t.locationId, t.tenantId], foreignColumns: [locations.id, locations.tenantId] }),
    foreignKey({ name: 'sales_cashier_user_fk', columns: [t.cashierUserId, t.tenantId], foreignColumns: [users.id, users.tenantId] }),
    foreignKey({ name: 'sales_device_fk', columns: [t.deviceId, t.tenantId], foreignColumns: [devices.id, devices.tenantId] }),
    tenantIsolationPolicy('sales'),
  ],
);

/**
 * A sale line. `location_id`, `occurred_at` and `cashier_user_id` are copies of
 * the header, written once in the same transaction and enforced by
 * sale_lines_sale_fk, so the KPIs read only this table through
 * the covering index `sale_lines_kpi_idx` (tenant_id, location_id, occurred_at)
 * INCLUDE (currency, payment_method, line_total, profit, sale_id, product_id,
 * quantity), which is in the custom migrations 0016 and 0017: drizzle-kit does
 * not model INCLUDE.
 */
export const saleLines = pgTable(
  'sale_lines',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    saleId: uuid('sale_id').notNull(),
    locationId: uuid('location_id').notNull(),
    productId: uuid('product_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    cashierUserId: uuid('cashier_user_id').notNull(),
    currency: text('currency').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    // The applied unit price, discount already included (spec "precio aplicado", saleLineAmounts):
    // line_total = round(quantity × unit_price). discount_percent only records the discount given.
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull(),
    paymentMethod: text('payment_method').notNull(),
    isCostSale: boolean('is_cost_sale').notNull(),
    // effectiveUnitCost under the lock of the pair; may carry a fraction of a cent.
    unitCost: numeric('unit_cost', { precision: 20, scale: 6 }).notNull(),
    lineTotal: bigint('line_total', { mode: 'number' }).notNull(),
    // Negative when sold below cost.
    profit: numeric('profit', { precision: 20, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('sale_lines_currency_check', oneOf('currency', CURRENCIES)),
    check('sale_lines_payment_method_check', oneOf('payment_method', PAYMENT_METHODS)),
    check('sale_lines_quantity_check', sql`${t.quantity} > 0`),
    check('sale_lines_unit_price_check', sql`${t.unitPrice} >= 0`),
    check('sale_lines_discount_percent_check', sql`${t.discountPercent} between 0 and 100`),
    check('sale_lines_unit_cost_check', sql`${t.unitCost} >= 0`),
    check('sale_lines_line_total_check', sql`${t.lineTotal} >= 0`),
    // Over the copied columns too, so a line cannot drift from its header.
    foreignKey({
      name: 'sale_lines_sale_fk',
      columns: [t.saleId, t.tenantId, t.locationId, t.occurredAt, t.cashierUserId],
      foreignColumns: [sales.id, sales.tenantId, sales.locationId, sales.occurredAt, sales.cashierUserId],
    }),
    foreignKey({
      name: 'sale_lines_location_product_fk',
      columns: [t.tenantId, t.locationId, t.productId],
      foreignColumns: [locationProducts.tenantId, locationProducts.locationId, locationProducts.productId],
    }),
    // Product rankings and "last sale" per product.
    index('sale_lines_tenant_id_location_id_product_id_occurred_at_idx').on(t.tenantId, t.locationId, t.productId, t.occurredAt),
    tenantIsolationPolicy('sale_lines'),
  ],
);
