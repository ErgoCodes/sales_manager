import { EXIT_REASONS, INVENTORY_DOCUMENT_KINDS, MAX_NOTES_LENGTH } from '@monaco/contracts';
import { INVENTORY_MOVEMENT_KINDS } from '@monaco/domain';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { locationProducts } from './catalog';
import { oneOf } from './checks';
import { users } from './iam';
import { locations, tenantRef } from './tenants';
import { tenantIsolationPolicy } from './tenancy';
import { createdAt, primaryId } from './types';

/*
 * Inventory ledger (SP3 spec, ADR 0006). Append-only: monaco_app only has
 * INSERT and SELECT on both tables (migration 0011). There is no stock column:
 * stock is SUM(quantity_delta), and the sign of each delta comes from
 * movementDelta in @monaco/domain. The sign CHECKs are defence in depth, not
 * the rule. Kinds are generated from the shared catalogs, like the permission
 * CHECK.
 */

/** A header: one command (entry, exit, adjustment, transfer, reversal or sale). `id` comes from the client. */
export const inventoryDocuments = pgTable(
  'inventory_documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantRef(),
    kind: text('kind').notNull(),
    locationId: uuid('location_id').notNull(),
    // Only for transfers.
    targetLocationId: uuid('target_location_id'),
    // Only for exits.
    reason: text('reason'),
    // Only for reversals; a document is reversed at most once.
    reversesDocumentId: uuid('reverses_document_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    // SHA-256 of the body as the client sent it (idempotency).
    payloadHash: text('payload_hash').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('inventory_documents_kind_check', oneOf('kind', INVENTORY_DOCUMENT_KINDS)),
    check('inventory_documents_reason_check', oneOf('reason', EXIT_REASONS)),
    check('inventory_documents_reason_shape_check', sql`(${t.kind} = 'exit') = (${t.reason} is not null)`),
    check('inventory_documents_target_shape_check', sql`(${t.kind} = 'transfer') = (${t.targetLocationId} is not null)`),
    check('inventory_documents_target_differs_check', sql`${t.targetLocationId} is null or ${t.targetLocationId} <> ${t.locationId}`),
    check('inventory_documents_reverses_shape_check', sql`(${t.kind} = 'reversal') = (${t.reversesDocumentId} is not null)`),
    check('inventory_documents_notes_length_check', sql.raw(`char_length(notes) <= ${MAX_NOTES_LENGTH}`)),
    unique('inventory_documents_id_tenant_id_unique').on(t.id, t.tenantId),
    // Target of sales_document_fk: a sale has the location and instant of its document (SP4).
    unique('inventory_documents_id_tenant_id_location_id_occurred_at_unique').on(t.id, t.tenantId, t.locationId, t.occurredAt),
    // A document is reversed once; the use case turns the 23505 into ALREADY_REVERSED.
    unique('inventory_documents_tenant_id_reverses_document_id_unique').on(t.tenantId, t.reversesDocumentId),
    foreignKey({ name: 'inventory_documents_location_fk', columns: [t.locationId, t.tenantId], foreignColumns: [locations.id, locations.tenantId] }),
    foreignKey({
      name: 'inventory_documents_target_location_fk',
      columns: [t.targetLocationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({ name: 'inventory_documents_created_by_fk', columns: [t.createdBy, t.tenantId], foreignColumns: [users.id, users.tenantId] }),
    foreignKey({
      name: 'inventory_documents_reverses_fk',
      columns: [t.reversesDocumentId, t.tenantId],
      foreignColumns: [t.id, t.tenantId],
    }),
    index('inventory_documents_tenant_id_location_id_created_at_id_idx').on(t.tenantId, t.locationId, t.createdAt, t.id),
    // Losses and reversed entries in the reports (SP4 spec, "Consultas e índices").
    index('inventory_documents_tenant_id_location_id_occurred_at_idx')
      .on(t.tenantId, t.locationId, t.occurredAt)
      .where(sql`${t.kind} in ('exit', 'entry')`),
    tenantIsolationPolicy('inventory_documents'),
  ],
);

/**
 * A line. Its (location, product) pair references location_products, so every
 * movement has the row that serves as the pair's lock. The covering index for
 * the stock sum, (tenant_id, location_id, product_id) INCLUDE (quantity_delta),
 * is in the custom migration: drizzle-kit does not model INCLUDE.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    documentId: uuid('document_id').notNull(),
    locationId: uuid('location_id').notNull(),
    productId: uuid('product_id').notNull(),
    kind: text('kind').notNull(),
    quantityDelta: numeric('quantity_delta', { precision: 14, scale: 3 }).notNull(),
    // Snapshot of the unit cost (minor units) when the line was written.
    unitCost: numeric('unit_cost', { precision: 20, scale: 6 }).notNull(),
    reversesMovementId: uuid('reverses_movement_id'),
    createdAt: createdAt(),
  },
  (t) => [
    check('inventory_movements_kind_check', oneOf('kind', INVENTORY_MOVEMENT_KINDS)),
    check('inventory_movements_quantity_delta_check', sql`${t.quantityDelta} <> 0`),
    check(
      'inventory_movements_sign_check',
      sql`case ${t.kind}
        when 'entry' then ${t.quantityDelta} > 0
        when 'transfer_in' then ${t.quantityDelta} > 0
        when 'shrinkage' then ${t.quantityDelta} < 0
        when 'owner_withdrawal' then ${t.quantityDelta} < 0
        when 'transfer_out' then ${t.quantityDelta} < 0
        when 'sale' then ${t.quantityDelta} < 0
        else true
      end`,
    ),
    check('inventory_movements_unit_cost_check', sql`${t.unitCost} >= 0`),
    unique('inventory_movements_id_tenant_id_unique').on(t.id, t.tenantId),
    foreignKey({
      name: 'inventory_movements_document_fk',
      columns: [t.documentId, t.tenantId],
      foreignColumns: [inventoryDocuments.id, inventoryDocuments.tenantId],
    }),
    foreignKey({
      name: 'inventory_movements_location_product_fk',
      columns: [t.tenantId, t.locationId, t.productId],
      foreignColumns: [locationProducts.tenantId, locationProducts.locationId, locationProducts.productId],
    }),
    foreignKey({ name: 'inventory_movements_reverses_fk', columns: [t.reversesMovementId, t.tenantId], foreignColumns: [t.id, t.tenantId] }),
    index('inventory_movements_tenant_id_document_id_idx').on(t.tenantId, t.documentId),
    tenantIsolationPolicy('inventory_movements'),
  ],
);
