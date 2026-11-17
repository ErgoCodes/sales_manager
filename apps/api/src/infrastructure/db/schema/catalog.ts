import { CATEGORIES, UNITS_OF_MEASURE } from '@monaco/domain';
import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { locations, tenantRef } from './tenants';
import { tenantIsolationPolicy } from './tenancy';
import { createdAt, primaryId } from './types';

/*
 * Catalog (SP3 spec, "Modelo de datos"). Amounts are integers in minor units
 * (`bigint`) in the product's currency; quantities are numeric(14,3). The unit
 * and category lists live in @monaco/domain and the CHECKs below are generated
 * from them, like the permission CHECK: adding a value needs a new migration
 * (catalog-inventory-schema.test.ts fails until it exists).
 */

export const CURRENCIES = ['CUP', 'USD', 'MLC'] as const;
export const UNIT_VALUES = UNITS_OF_MEASURE.map((unit) => unit.value);

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(', ')})`);
/** NULL passes a CHECK, so nullable amounts only need the bound. */
const minorUnits = (name: string) => bigint(name, { mode: 'number' });

export const products = pgTable(
  'products',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    unitOfMeasure: text('unit_of_measure').notNull(),
    category: text('category'),
    currency: text('currency').notNull(),
    costPrice: minorUnits('cost_price'),
    cashPrice: minorUnits('cash_price'),
    transferPrice: minorUnits('transfer_price'),
    lowStockThreshold: numeric('low_stock_threshold', { precision: 14, scale: 3 }),
    expirationDate: date('expiration_date'),
    // Archived instead of deleted: monaco_app has no DELETE on products.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('products_unit_of_measure_check', oneOf('unit_of_measure', UNIT_VALUES)),
    check('products_category_check', oneOf('category', CATEGORIES)),
    check('products_currency_check', oneOf('currency', CURRENCIES)),
    check('products_cost_price_check', sql`${t.costPrice} >= 0`),
    check('products_cash_price_check', sql`${t.cashPrice} >= 0`),
    check('products_transfer_price_check', sql`${t.transferPrice} >= 0`),
    check('products_low_stock_threshold_check', sql`${t.lowStockThreshold} >= 0`),
    unique('products_id_tenant_id_unique').on(t.id, t.tenantId),
    index('products_tenant_id_lower_name_idx').on(t.tenantId, sql`lower(${t.name})`),
    index('products_tenant_id_archived_at_idx').on(t.tenantId, t.archivedAt),
    tenantIsolationPolicy('products'),
  ],
);

/**
 * One row per (location, product), created lazily. It is the per-location price
 * override, the projection of the average cost and the mutex of the pair: the
 * inventory use cases lock it FOR UPDATE before writing movements (ADR 0006).
 */
export const locationProducts = pgTable(
  'location_products',
  {
    tenantId: tenantRef(),
    locationId: uuid('location_id').notNull(),
    productId: uuid('product_id').notNull(),
    cashPriceOverride: minorUnits('cash_price_override'),
    transferPriceOverride: minorUnits('transfer_price_override'),
    // Minor units; may carry a fraction of a cent.
    averageCost: numeric('average_cost', { precision: 20, scale: 6 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'location_products_pkey', columns: [t.tenantId, t.locationId, t.productId] }),
    foreignKey({ name: 'location_products_location_fk', columns: [t.locationId, t.tenantId], foreignColumns: [locations.id, locations.tenantId] }),
    foreignKey({ name: 'location_products_product_fk', columns: [t.productId, t.tenantId], foreignColumns: [products.id, products.tenantId] }),
    check('location_products_cash_price_override_check', sql`${t.cashPriceOverride} >= 0`),
    check('location_products_transfer_price_override_check', sql`${t.transferPriceOverride} >= 0`),
    check('location_products_average_cost_check', sql`${t.averageCost} >= 0`),
    index('location_products_tenant_id_product_id_idx').on(t.tenantId, t.productId),
    tenantIsolationPolicy('location_products'),
  ],
);
