import { and, desc, eq, inArray, sql } from 'drizzle-orm';

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
  const newAverageCost = await recalculateAverageCost(
    data.productId,
    data.quantity,
    data.unitCostPrice,
  );

  await db.insert(warehouseMovements).values({
    productId: data.productId,
    type: 'entrada',
    quantity: data.quantity,
    date: data.date,
    unitCostPrice: data.unitCostPrice,
    salePrice: data.salePrice ?? null,
    notes: data.notes ?? null,
  });

  await db
    .update(products)
    .set({ averageCost: newAverageCost })
    .where(eq(products.id, data.productId));
}

interface OutflowData {
  productId: number;
  /** 'merma' | 'retiro_owner' | 'ajuste' */
  type: string;
  /** Para 'ajuste' puede ser negativo (la fórmula de stock lo suma). */
  quantity: number;
  unitCostPrice: number;
  date: string;
  notes?: string | null;
}

/**
 * Registra una salida de almacén que no es venta (T-13): merma, retiro del
 * dueño o ajuste de inventario. A diferencia de una entrada, NO recalcula el
 * costo promedio (el promedio ponderado solo cambia con entradas), lo que deja
 * el costo congelado para valorar la pérdida en reportes (T-19).
 */
export async function registerOutflow(data: OutflowData): Promise<void> {
  await db.insert(warehouseMovements).values({
    productId: data.productId,
    type: data.type,
    quantity: data.quantity,
    date: data.date,
    unitCostPrice: data.unitCostPrice,
    salePrice: null,
    notes: data.notes ?? null,
  });
}

/** Actualiza los campos editables de una salida existente (T-15). */
export async function updateOutflow(
  id: number,
  data: Partial<{
    productId: number;
    type: string;
    quantity: number;
    unitCostPrice: number;
    date: string;
    notes: string | null;
  }>,
): Promise<void> {
  await db.update(warehouseMovements).set(data).where(eq(warehouseMovements.id, id));
}

/** Devuelve una salida por su id (para edición T-15). */
export async function getOutflowById(id: number) {
  const [row] = await db
    .select({
      id: warehouseMovements.id,
      productId: warehouseMovements.productId,
      productName: products.name,
      unitOfMeasure: products.unitOfMeasure,
      type: warehouseMovements.type,
      quantity: warehouseMovements.quantity,
      unitCostPrice: warehouseMovements.unitCostPrice,
      date: warehouseMovements.date,
      notes: warehouseMovements.notes,
      cancelled: warehouseMovements.cancelled,
      costPrice: products.costPrice,
      cashPrice: products.cashPrice,
      transferPrice: products.transferPrice,
      averageCost: products.averageCost,
    })
    .from(warehouseMovements)
    .innerJoin(products, eq(warehouseMovements.productId, products.id))
    .where(eq(warehouseMovements.id, id));
  return row ?? null;
}

/** Soft-delete: marca la salida como anulada (T-15). */
export async function cancelOutflow(id: number): Promise<void> {
  await db.update(warehouseMovements).set({ cancelled: true }).where(eq(warehouseMovements.id, id));
}

/** Restaura una salida anulada (undo). */
export async function restoreOutflow(id: number): Promise<void> {
  await db.update(warehouseMovements).set({ cancelled: false }).where(eq(warehouseMovements.id, id));
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

export interface MovementWithProduct {
  id: number;
  productId: number;
  productName: string;
  unitOfMeasure: string;
  type: string;
  quantity: number;
  unitCostPrice: number;
  date: string;
  notes: string | null;
  cancelled: boolean;
}

interface ListMovementsOptions {
  types?: string[];
  productId?: number;
  dateFrom?: string;
  dateTo?: string;
  includeCancelled?: boolean;
}

/** Lista movimientos de almacén (filtrable por tipo, p. ej. las salidas T-13). */
export async function listMovements(
  opts: ListMovementsOptions = {},
): Promise<MovementWithProduct[]> {
  const conditions = [];
  if (!opts.includeCancelled) conditions.push(eq(warehouseMovements.cancelled, false));
  if (opts.types && opts.types.length > 0)
    conditions.push(inArray(warehouseMovements.type, opts.types));
  if (opts.productId) conditions.push(eq(warehouseMovements.productId, opts.productId));
  if (opts.dateFrom)
    conditions.push(sql`date(${warehouseMovements.date}) >= date(${opts.dateFrom})`);
  if (opts.dateTo)
    conditions.push(sql`date(${warehouseMovements.date}) <= date(${opts.dateTo})`);

  return db
    .select({
      id: warehouseMovements.id,
      productId: warehouseMovements.productId,
      productName: products.name,
      unitOfMeasure: products.unitOfMeasure,
      type: warehouseMovements.type,
      quantity: warehouseMovements.quantity,
      unitCostPrice: warehouseMovements.unitCostPrice,
      date: warehouseMovements.date,
      notes: warehouseMovements.notes,
      cancelled: warehouseMovements.cancelled,
    })
    .from(warehouseMovements)
    .innerJoin(products, eq(warehouseMovements.productId, products.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(warehouseMovements.date));
}

/**
 * Valor de las salidas que cuentan como pérdida (merma + retiro del dueño)
 * en un rango de fechas: SUM(|cantidad| × costo unitario). El 'ajuste' se
 * excluye porque es una corrección de conteo, no una pérdida.
 */
export async function sumLossOutflowsValue(
  dateFrom?: string,
  dateTo?: string,
): Promise<number> {
  const conditions = [
    inArray(warehouseMovements.type, ['merma', 'retiro_owner']),
    eq(warehouseMovements.cancelled, false),
  ];
  if (dateFrom)
    conditions.push(sql`date(${warehouseMovements.date}) >= date(${dateFrom})`);
  if (dateTo)
    conditions.push(sql`date(${warehouseMovements.date}) <= date(${dateTo})`);

  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(ABS(${warehouseMovements.quantity}) * ${warehouseMovements.unitCostPrice}), 0)`,
    })
    .from(warehouseMovements)
    .where(and(...conditions));

  return row?.total ?? 0;
}
