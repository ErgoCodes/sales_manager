import { InventoryDocument } from '@monaco/contracts';
import type { Pool } from 'pg';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import type { Session } from './admin-fixtures';

/** A catalog product, inserted as superuser (the catalog API belongs to T4). */
export async function insertProduct(admin: Pool, tenant: string, name: string, currency: 'CUP' | 'USD' | 'MLC' = 'CUP', archived = false): Promise<string> {
  const id = uuidv7();
  await admin.query(
    `insert into products (id, tenant_id, name, unit_of_measure, currency, archived_at) values ($1, $2, $3, 'kg', $4, $5)`,
    [id, tenant, name, currency, archived ? new Date() : null],
  );
  return id;
}

/** SUM(quantity_delta) of a pair, the only definition of stock. */
export async function stockOf(admin: Pool, tenant: string, location: string, product: string): Promise<number> {
  const { rows } = await admin.query<{ stock: string }>(
    `select coalesce(sum(quantity_delta), 0)::text as stock from inventory_movements where tenant_id = $1 and location_id = $2 and product_id = $3`,
    [tenant, location, product],
  );
  return Number(rows[0]!.stock);
}

export async function averageCostOf(admin: Pool, tenant: string, location: string, product: string): Promise<number | null> {
  const { rows } = await admin.query<{ average_cost: string }>(
    `select average_cost::text from location_products where tenant_id = $1 and location_id = $2 and product_id = $3`,
    [tenant, location, product],
  );
  return rows[0] ? Number(rows[0].average_cost) : null;
}

export async function countRows(admin: Pool, table: 'inventory_documents' | 'inventory_movements' | 'location_products', tenant: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenant]);
  return rows[0]!.n;
}

const cup = (amount: number) => ({ amount, currency: 'CUP' as const });

export const entryBody = (locationId: string, productId: string, quantity: number, unitCost: number, id = uuidv7()) => ({
  id,
  locationId,
  lines: [{ productId, quantity, unitCost: cup(unitCost) }],
});
export const exitBody = (locationId: string, productId: string, quantity: number, id = uuidv7(), reason: 'shrinkage' | 'owner_withdrawal' = 'shrinkage') => ({
  id,
  locationId,
  reason,
  lines: [{ productId, quantity }],
});
export const adjustmentBody = (locationId: string, productId: string, quantityDelta: number, id = uuidv7()) => ({
  id,
  locationId,
  lines: [{ productId, quantityDelta }],
});

/** Records an entry as `session` and returns the parsed document (fails the test unless 201). */
export async function recordEntry(session: Session, locationId: string, productId: string, quantity: number, unitCost: number) {
  const res = await session.post('/inventory/entries', entryBody(locationId, productId, quantity, unitCost)).expect(201);
  return InventoryDocument.parse(res.body);
}

/**
 * A transfer document as T6 will write it (one document, `transfer_out` in the origin and
 * `transfer_in` in the destination), inserted as superuser so the reads can be tested now.
 */
export async function insertTransfer(
  admin: Pool,
  tenant: { id: string; owner: string },
  from: string,
  to: string,
  productId: string,
  quantity: number,
  unitCost: number,
): Promise<string> {
  const documentId = uuidv7();
  for (const location of [from, to]) {
    await admin.query(`insert into location_products (tenant_id, location_id, product_id) values ($1, $2, $3) on conflict do nothing`, [tenant.id, location, productId]);
  }
  await admin.query(
    `insert into inventory_documents (id, tenant_id, kind, location_id, target_location_id, occurred_at, payload_hash, created_by)
     values ($1, $2, 'transfer', $3, $4, now(), 'h', $5)`,
    [documentId, tenant.id, from, to, tenant.owner],
  );
  await admin.query(
    `insert into inventory_movements (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost, created_at)
     values ($1, $2, $3, $4, $5, 'transfer_out', $6, $7, clock_timestamp()), ($8, $2, $3, $9, $5, 'transfer_in', $10, $7, clock_timestamp())`,
    [uuidv7(), tenant.id, documentId, from, productId, -quantity, unitCost, uuidv7(), to, quantity],
  );
  return documentId;
}

export const transferBody = (fromLocationId: string, toLocationId: string, productId: string, quantity: number, id = uuidv7()) => ({
  id,
  fromLocationId,
  toLocationId,
  lines: [{ productId, quantity }],
});

export const reversalBody = (id = uuidv7(), notes?: string) => ({ id, ...(notes === undefined ? {} : { notes }) });

/** Records a transfer through the API as `session` (fails the test unless 201). */
export async function recordTransfer(session: Session, fromLocationId: string, toLocationId: string, productId: string, quantity: number) {
  const res = await session.post('/inventory/transfers', transferBody(fromLocationId, toLocationId, productId, quantity)).expect(201);
  return InventoryDocument.parse(res.body);
}
