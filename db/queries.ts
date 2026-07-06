import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from './client';
import { CONFIG_KEYS, getConfig } from './config';
import { products, sales, warehouseMovements } from './schema';

export async function calculateStock(productId: number): Promise<number> {
  const [movRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CASE
        WHEN ${warehouseMovements.type} IN ('entrada', 'ajuste') THEN ${warehouseMovements.quantity}
        ELSE -${warehouseMovements.quantity}
      END), 0)`,
    })
    .from(warehouseMovements)
    .where(eq(warehouseMovements.productId, productId));

  const [saleRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${sales.quantity}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.productId, productId), eq(sales.cancelled, false)));

  return (movRow?.total ?? 0) - (saleRow?.total ?? 0);
}

export async function calculateAllStocks(): Promise<Map<number, number>> {
  const movRows = await db
    .select({
      productId: warehouseMovements.productId,
      total: sql<number>`COALESCE(SUM(CASE
        WHEN ${warehouseMovements.type} IN ('entrada', 'ajuste') THEN ${warehouseMovements.quantity}
        ELSE -${warehouseMovements.quantity}
      END), 0)`,
    })
    .from(warehouseMovements)
    .groupBy(warehouseMovements.productId);

  const saleRows = await db
    .select({
      productId: sales.productId,
      total: sql<number>`COALESCE(SUM(${sales.quantity}), 0)`,
    })
    .from(sales)
    .where(eq(sales.cancelled, false))
    .groupBy(sales.productId);

  const stock = new Map<number, number>();
  for (const row of movRows) stock.set(row.productId, row.total);
  for (const row of saleRows) {
    stock.set(row.productId, (stock.get(row.productId) ?? 0) - row.total);
  }
  return stock;
}

export async function recalculateAverageCost(
  productId: number,
  newQuantity: number,
  newCost: number,
): Promise<number> {
  const currentStock = await calculateStock(productId);

  const [prod] = await db
    .select({ averageCost: products.averageCost })
    .from(products)
    .where(eq(products.id, productId));

  const currentAverageCost = prod?.averageCost ?? 0;
  const denominator = currentStock + newQuantity;

  if (denominator <= 0) return newCost;

  return (currentStock * currentAverageCost + newQuantity * newCost) / denominator;
}

export interface DailySummary {
  cash: number;
  transfer: number;
  total: number;
  profit: number;
}

export async function getDailySummary(date: string): Promise<DailySummary> {
  const revenue = sql<number>`${sales.appliedPrice} * ${sales.quantity}`;

  const rows = await db
    .select({
      paymentMethod: sales.paymentMethod,
      revenue: sql<number>`COALESCE(SUM(${revenue}), 0)`,
      profit: sql<number>`COALESCE(SUM(${sales.profit}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.cancelled, false), sql`date(${sales.date}) = date(${date})`))
    .groupBy(sales.paymentMethod);

  const summary: DailySummary = { cash: 0, transfer: 0, total: 0, profit: 0 };
  for (const row of rows) {
    if (row.paymentMethod === 'efectivo') summary.cash += row.revenue;
    else if (row.paymentMethod === 'transferencia') summary.transfer += row.revenue;
    summary.total += row.revenue;
    summary.profit += row.profit;
  }
  return summary;
}

export interface ProductDaySummary {
  productId: number;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
  totalProfit: number;
}

export async function getDailyBreakdown(date: string): Promise<ProductDaySummary[]> {
  const revenue = sql<number>`${sales.appliedPrice} * ${sales.quantity}`;

  return db
    .select({
      productId: sales.productId,
      productName: products.name,
      totalQuantity: sql<number>`COALESCE(SUM(${sales.quantity}), 0)`,
      totalRevenue: sql<number>`COALESCE(SUM(${revenue}), 0)`,
      totalProfit: sql<number>`COALESCE(SUM(${sales.profit}), 0)`,
    })
    .from(sales)
    .innerJoin(products, eq(sales.productId, products.id))
    .where(and(eq(sales.cancelled, false), sql`date(${sales.date}) = date(${date})`))
    .groupBy(sales.productId)
    .orderBy(desc(sql`COALESCE(SUM(${revenue}), 0)`));
}

export async function getLastSaleDate(productId: number): Promise<string | null> {
  const [row] = await db
    .select({ lastDate: sql<string>`MAX(${sales.date})` })
    .from(sales)
    .where(and(eq(sales.productId, productId), eq(sales.cancelled, false)));
  return row?.lastDate ?? null;
}

export async function getLastSaleDates(): Promise<Map<number, string>> {
  const rows = await db
    .select({
      productId: sales.productId,
      lastDate: sql<string>`MAX(${sales.date})`,
    })
    .from(sales)
    .where(eq(sales.cancelled, false))
    .groupBy(sales.productId);

  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.lastDate) map.set(row.productId, row.lastDate);
  }
  return map;
}

export async function countLowStock(): Promise<number> {
  const generalThreshold = Number(
    (await getConfig(CONFIG_KEYS.generalStockThreshold)) ?? 5,
  );

  const activeProducts = await db
    .select({ id: products.id, lowStockThreshold: products.lowStockThreshold })
    .from(products)
    .where(eq(products.active, true));

  let count = 0;
  for (const p of activeProducts) {
    const stock = await calculateStock(p.id);
    const threshold = p.lowStockThreshold ?? generalThreshold;
    if (stock < threshold) count += 1;
  }
  return count;
}
