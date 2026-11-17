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
