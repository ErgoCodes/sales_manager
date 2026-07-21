import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getProductThreshold } from "@/drizzle/constants/catalog";
import { effectiveUnitCost } from "../lib/pricing";
import { db } from "./client";
import { CONFIG_KEYS, getConfig } from "./config";
import { expenses, products, sales, warehouseMovements } from "./schema";

export async function calculateStock(productId: number): Promise<number> {
  const [movRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CASE
        WHEN ${warehouseMovements.type} IN ('entrada', 'ajuste') THEN ${warehouseMovements.quantity}
        ELSE -${warehouseMovements.quantity}
      END), 0)`,
    })
    .from(warehouseMovements)
    .where(
      and(
        eq(warehouseMovements.productId, productId),
        eq(warehouseMovements.cancelled, false)
      )
    );

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
    .where(eq(warehouseMovements.cancelled, false))
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
  newCost: number
): Promise<number> {
  const currentStock = await calculateStock(productId);

  const [prod] = await db
    .select({ averageCost: products.averageCost, costPrice: products.costPrice })
    .from(products)
    .where(eq(products.id, productId));

  const currentAverageCost = prod ? effectiveUnitCost(prod) : 0;
  const denominator = currentStock + newQuantity;

  if (denominator <= 0) return newCost;
  if (currentStock <= 0 || currentAverageCost <= 0) return newCost;

  return (
    (currentStock * currentAverageCost + newQuantity * newCost) / denominator
  );
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
    .where(
      and(eq(sales.cancelled, false), sql`date(${sales.date}) = date(${date})`)
    )
    .groupBy(sales.paymentMethod);

  const summary: DailySummary = { cash: 0, transfer: 0, total: 0, profit: 0 };
  for (const row of rows) {
    if (row.paymentMethod === "efectivo") summary.cash += row.revenue;
    else if (row.paymentMethod === "transferencia")
      summary.transfer += row.revenue;
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

export async function getDailyBreakdown(
  date: string
): Promise<ProductDaySummary[]> {
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
    .where(
      and(eq(sales.cancelled, false), sql`date(${sales.date}) = date(${date})`)
    )
    .groupBy(sales.productId)
    .orderBy(desc(sql`COALESCE(SUM(${revenue}), 0)`));
}

/**
 * Totales de ventas en un rango de fechas [from, to] inclusive. Generalización
 * de `getDailySummary`: mismo cálculo pero filtrando con el par
 * `date(col) >= date(from)` / `date(col) <= date(to)`.
 */
export async function getRangeSummary(
  from: string,
  to: string
): Promise<DailySummary> {
  const revenue = sql<number>`${sales.appliedPrice} * ${sales.quantity}`;

  const rows = await db
    .select({
      paymentMethod: sales.paymentMethod,
      revenue: sql<number>`COALESCE(SUM(${revenue}), 0)`,
      profit: sql<number>`COALESCE(SUM(${sales.profit}), 0)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.cancelled, false),
        sql`date(${sales.date}) >= date(${from})`,
        sql`date(${sales.date}) <= date(${to})`
      )
    )
    .groupBy(sales.paymentMethod);

  const summary: DailySummary = { cash: 0, transfer: 0, total: 0, profit: 0 };
  for (const row of rows) {
    if (row.paymentMethod === "efectivo") summary.cash += row.revenue;
    else if (row.paymentMethod === "transferencia")
      summary.transfer += row.revenue;
    summary.total += row.revenue;
    summary.profit += row.profit;
  }
  return summary;
}

/** Desglose por producto en un rango de fechas (clon por rango de `getDailyBreakdown`). */
export async function getRangeBreakdown(
  from: string,
  to: string
): Promise<ProductDaySummary[]> {
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
    .where(
      and(
        eq(sales.cancelled, false),
        sql`date(${sales.date}) >= date(${from})`,
        sql`date(${sales.date}) <= date(${to})`
      )
    )
    .groupBy(sales.productId)
    .orderBy(desc(sql`COALESCE(SUM(${revenue}), 0)`));
}

export interface DayTotals {
  date: string;
  cash: number;
  transfer: number;
  total: number;
  profit: number;
}

/**
 * Serie diaria de totales dentro de un rango: una fila por día con ventas,
 * agrupada por `date(fecha)`. Alimenta la vista semanal (agregado por día).
 */
export async function getDailyTotalsInRange(
  from: string,
  to: string
): Promise<DayTotals[]> {
  const revenue = sql<number>`${sales.appliedPrice} * ${sales.quantity}`;

  return db
    .select({
      date: sql<string>`date(${sales.date})`,
      cash: sql<number>`COALESCE(SUM(CASE WHEN ${sales.paymentMethod} = 'efectivo' THEN ${revenue} ELSE 0 END), 0)`,
      transfer: sql<number>`COALESCE(SUM(CASE WHEN ${sales.paymentMethod} = 'transferencia' THEN ${revenue} ELSE 0 END), 0)`,
      total: sql<number>`COALESCE(SUM(${revenue}), 0)`,
      profit: sql<number>`COALESCE(SUM(${sales.profit}), 0)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.cancelled, false),
        sql`date(${sales.date}) >= date(${from})`,
        sql`date(${sales.date}) <= date(${to})`
      )
    )
    .groupBy(sql`date(${sales.date})`)
    .orderBy(sql`date(${sales.date})`);
}

export type RankingSortBy = "quantity" | "profit";

export interface ProductRanking {
  productId: number;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
  totalProfit: number;
  /** SUM(utilidad) / SUM(ingreso); 0 cuando no hubo ingreso. */
  margin: number;
}

/**
 * Ranking de productos por rango, ordenable por unidades vendidas (más
 * vendidos) o por utilidad acumulada (más rentables). Incluye el margen.
 */
export async function getRangeRanking(
  from: string,
  to: string,
  sortBy: RankingSortBy
): Promise<ProductRanking[]> {
  const revenue = sql<number>`${sales.appliedPrice} * ${sales.quantity}`;
  const quantitySum = sql<number>`COALESCE(SUM(${sales.quantity}), 0)`;
  const revenueSum = sql<number>`COALESCE(SUM(${revenue}), 0)`;
  const profitSum = sql<number>`COALESCE(SUM(${sales.profit}), 0)`;
  const orderExpr = sortBy === "quantity" ? quantitySum : profitSum;

  const rows = await db
    .select({
      productId: sales.productId,
      productName: products.name,
      totalQuantity: quantitySum,
      totalRevenue: revenueSum,
      totalProfit: profitSum,
    })
    .from(sales)
    .innerJoin(products, eq(sales.productId, products.id))
    .where(
      and(
        eq(sales.cancelled, false),
        sql`date(${sales.date}) >= date(${from})`,
        sql`date(${sales.date}) <= date(${to})`
      )
    )
    .groupBy(sales.productId)
    .orderBy(desc(orderExpr));

  return rows.map((r) => ({
    ...r,
    margin: r.totalRevenue > 0 ? r.totalProfit / r.totalRevenue : 0,
  }));
}

export interface LossRecord {
  id: number;
  /** Concepto del gasto o nombre del producto, según la categoría. */
  label: string;
  amount: number;
  date: string;
}

export interface LossCategory {
  /** 'retiro_owner' | 'merma' | 'salario' | 'multa' | 'onat' | 'rebaja_liquidacion' */
  type: string;
  /** Título de sección legible (p. ej. 'Retiros'). */
  label: string;
  subtotal: number;
  records: LossRecord[];
}

export interface LossesBreakdown {
  categories: LossCategory[];
  total: number;
}

/** Orden y títulos de las categorías de pérdidas del reporte T-19. */
const LOSS_CATEGORIES: {
  type: string;
  label: string;
  source: "movement" | "expense";
}[] = [
  { type: "retiro_owner", label: "Retiros", source: "movement" },
  { type: "merma", label: "Mermas", source: "movement" },
  { type: "salario", label: "Salarios", source: "expense" },
  { type: "multa", label: "Multas", source: "expense" },
  { type: "onat", label: "ONAT", source: "expense" },
  { type: "rebaja_liquidacion", label: "Rebajas", source: "expense" },
];

/**
 * Pérdidas y gastos agrupados por categoría en un rango: salidas de almacén
 * valoradas a costo (`|cantidad| × precio_costo_unitario`) para merma y retiro
 * del dueño, más los gastos periódicos por tipo. Todas las categorías se
 * devuelven siempre (subtotal 0 y sin registros si no hubo movimientos).
 */
export async function getLossesBreakdown(
  from: string,
  to: string
): Promise<LossesBreakdown> {
  const [movementRows, expenseRows] = await Promise.all([
    db
      .select({
        id: warehouseMovements.id,
        type: warehouseMovements.type,
        productName: products.name,
        value: sql<number>`ABS(${warehouseMovements.quantity}) * ${warehouseMovements.unitCostPrice}`,
        date: warehouseMovements.date,
      })
      .from(warehouseMovements)
      .innerJoin(products, eq(warehouseMovements.productId, products.id))
      .where(
        and(
          inArray(warehouseMovements.type, ["merma", "retiro_owner"]),
          eq(warehouseMovements.cancelled, false),
          sql`date(${warehouseMovements.date}) >= date(${from})`,
          sql`date(${warehouseMovements.date}) <= date(${to})`
        )
      )
      .orderBy(desc(warehouseMovements.date)),
    db
      .select({
        id: expenses.id,
        type: expenses.type,
        concept: expenses.concept,
        amount: expenses.amount,
        date: expenses.date,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.cancelled, false),
          sql`date(${expenses.date}) >= date(${from})`,
          sql`date(${expenses.date}) <= date(${to})`
        )
      )
      .orderBy(desc(expenses.date)),
  ]);

  const recordsByType = new Map<string, LossRecord[]>();
  for (const row of movementRows) {
    const list = recordsByType.get(row.type) ?? [];
    list.push({
      id: row.id,
      label: row.productName,
      amount: row.value,
      date: row.date,
    });
    recordsByType.set(row.type, list);
  }
  for (const row of expenseRows) {
    const list = recordsByType.get(row.type) ?? [];
    list.push({
      id: row.id,
      label: row.concept && row.concept.length > 0 ? row.concept : "Gasto",
      amount: row.amount,
      date: row.date,
    });
    recordsByType.set(row.type, list);
  }

  let total = 0;
  const categories: LossCategory[] = LOSS_CATEGORIES.map((cat) => {
    const records = recordsByType.get(cat.type) ?? [];
    const subtotal = records.reduce((acc, r) => acc + r.amount, 0);
    total += subtotal;
    return { type: cat.type, label: cat.label, subtotal, records };
  });

  return { categories, total };
}

export async function getLastSaleDate(
  productId: number
): Promise<string | null> {
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
    (await getConfig(CONFIG_KEYS.generalStockThreshold)) ?? 5
  );

  const activeProducts = await db
    .select({
      id: products.id,
      lowStockThreshold: products.lowStockThreshold,
      category: products.category,
    })
    .from(products)
    .where(eq(products.active, true));

  const stocks = await calculateAllStocks();
  let count = 0;
  for (const p of activeProducts) {
    const stock = stocks.get(p.id) ?? 0;
    const threshold = getProductThreshold(p, generalThreshold);
    if (stock < threshold) count += 1;
  }
  return count;
}
