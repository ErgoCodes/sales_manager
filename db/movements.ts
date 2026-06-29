import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from './client';
import { recalculateAverageCost } from './queries';
import { products, warehouseMovements } from './schema';

interface EntryData {
  productId: number;
  quantity: number;
  unitCostPrice: number;
  salePrice?: number | null;
  date: string;
  notes?: string | null;
}

export async function registerEntry(data: EntryData): Promise<void> {
  await db.insert(warehouseMovements).values({
    productId: data.productId,
    type: 'entrada',
    quantity: data.quantity,
    date: data.date,
    unitCostPrice: data.unitCostPrice,
    salePrice: data.salePrice ?? null,
    notes: data.notes ?? null,
  });

  const newAverageCost = await recalculateAverageCost(
    data.productId,
    data.quantity,
    data.unitCostPrice,
  );

  await db
    .update(products)
    .set({ averageCost: newAverageCost })
    .where(eq(products.id, data.productId));
}

export interface EntryWithProduct {
  id: number;
  productId: number;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  unitCostPrice: number;
  date: string;
  notes: string | null;
}

interface ListOptions {
  productId?: number;
  dateFrom?: string;
  dateTo?: string;
}

export async function listEntries(opts: ListOptions = {}): Promise<EntryWithProduct[]> {
  const conditions = [eq(warehouseMovements.type, 'entrada')];
  if (opts.productId) conditions.push(eq(warehouseMovements.productId, opts.productId));
  if (opts.dateFrom)
    conditions.push(sql`date(${warehouseMovements.date}) >= date(${opts.dateFrom})`);
  if (opts.dateTo)
    conditions.push(sql`date(${warehouseMovements.date}) <= date(${opts.dateTo})`);

  const rows = await db
    .select({
      id: warehouseMovements.id,
      productId: warehouseMovements.productId,
      productName: products.name,
      unitOfMeasure: products.unitOfMeasure,
      quantity: warehouseMovements.quantity,
      unitCostPrice: warehouseMovements.unitCostPrice,
      date: warehouseMovements.date,
      notes: warehouseMovements.notes,
    })
    .from(warehouseMovements)
    .innerJoin(products, eq(warehouseMovements.productId, products.id))
    .where(and(...conditions))
    .orderBy(desc(warehouseMovements.date));

  return rows;
}
