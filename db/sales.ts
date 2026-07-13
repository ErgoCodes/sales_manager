import { and, desc, eq, sql } from 'drizzle-orm';

import type { CartItem } from '@/store';

import { db } from './client';
import { calculateAllStocks } from './queries';
import { products, saleSessions, sales } from './schema';

export interface StockWarning {
  name: string;
  currentStock: number;
  quantityToSell: number;
  resultingStock: number;
}

export async function verifySessionStock(
  items: CartItem[],
): Promise<StockWarning[]> {
  const byProduct = new Map<number, { name: string; quantity: number }>();
  for (const item of items) {
    const existing = byProduct.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      byProduct.set(item.productId, {
        name: item.name,
        quantity: item.quantity,
      });
    }
  }

  const stocks = await calculateAllStocks();
  const warnings: StockWarning[] = [];
  for (const [productId, { name, quantity }] of byProduct) {
    const stock = stocks.get(productId) ?? 0;
    const resulting = stock - quantity;
    if (resulting < 0) {
      warnings.push({
        name,
        currentStock: stock,
        quantityToSell: quantity,
        resultingStock: resulting,
      });
    }
  }
  return warnings;
}

/**
 * Registers all cart lines in a single transaction. When `cashPayment` is
 * provided (the cashier entered how much the customer handed over), a
 * `saleSessions` row is created snapshotting the cash total, amount received
 * and change, and every line of this ticket is linked to it via `sessionId`.
 * Without it, behaviour is unchanged and rows keep `sessionId = null`.
 */
export function registerSalesSession(
  items: CartItem[],
  date: string,
  cashPayment?: { amountReceived: number },
): number {
  return db.transaction((tx) => {
    let sessionId: number | null = null;

    if (cashPayment && cashPayment.amountReceived > 0) {
      const cashTotal = items
        .filter((i) => i.paymentMethod === 'efectivo')
        .reduce((sum, i) => sum + i.appliedPrice * i.quantity, 0);

      const [session] = tx
        .insert(saleSessions)
        .values({
          date,
          cashTotal,
          amountReceived: cashPayment.amountReceived,
          change: cashPayment.amountReceived - cashTotal,
          createdAt: new Date().toISOString(),
        })
        .returning({ id: saleSessions.id })
        .all();

      sessionId = session?.id ?? null;
    }

    let inserted = 0;

    for (const item of items) {
      const [prod] = tx
        .select({ averageCost: products.averageCost })
        .from(products)
        .where(eq(products.id, item.productId))
        .all();

      const costAtSale = prod?.averageCost ?? item.costAtSale;
      const profit = (item.appliedPrice - costAtSale) * item.quantity;

      tx.insert(sales)
        .values({
          productId: item.productId,
          quantity: item.quantity,
          appliedPrice: item.appliedPrice,
          paymentMethod: item.paymentMethod,
          costAtSale,
          profit,
          date,
          discountPercent: item.discountPercent,
          cancelled: false,
          sessionId,
        })
        .run();

      inserted++;
    }

    return inserted;
  });
}

export interface SaleWithProduct {
  id: number;
  productId: number;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  appliedPrice: number;
  discountPercent: number;
  paymentMethod: string;
  costAtSale: number;
  profit: number;
  date: string;
  cancelled: boolean;
  sessionId: number | null;
  amountReceived: number | null;
  change: number | null;
}

interface ListSalesOptions {
  productId?: number;
  dateFrom?: string;
  dateTo?: string;
  includeCancelled?: boolean;
}

export async function listSales(opts: ListSalesOptions = {}): Promise<SaleWithProduct[]> {
  const conditions = [];
  if (!opts.includeCancelled) conditions.push(eq(sales.cancelled, false));
  if (opts.productId) conditions.push(eq(sales.productId, opts.productId));
  if (opts.dateFrom)
    conditions.push(sql`date(${sales.date}) >= date(${opts.dateFrom})`);
  if (opts.dateTo)
    conditions.push(sql`date(${sales.date}) <= date(${opts.dateTo})`);

  return db
    .select({
      id: sales.id,
      productId: sales.productId,
      productName: products.name,
      unitOfMeasure: products.unitOfMeasure,
      quantity: sales.quantity,
      appliedPrice: sales.appliedPrice,
      discountPercent: sales.discountPercent,
      paymentMethod: sales.paymentMethod,
      costAtSale: sales.costAtSale,
      profit: sales.profit,
      date: sales.date,
      cancelled: sales.cancelled,
      sessionId: sales.sessionId,
      amountReceived: saleSessions.amountReceived,
      change: saleSessions.change,
    })
    .from(sales)
    .innerJoin(products, eq(sales.productId, products.id))
    .leftJoin(saleSessions, eq(sales.sessionId, saleSessions.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(sales.date));
}

/** Soft delete: marks a sale as cancelled. Stock and reports adjust automatically. */
export async function cancelSale(id: number): Promise<void> {
  await db.update(sales).set({ cancelled: true }).where(eq(sales.id, id));
}

/** Reverts a cancellation (undo for the "deshacer" snackbar). */
export async function restoreSale(id: number): Promise<void> {
  await db.update(sales).set({ cancelled: false }).where(eq(sales.id, id));
}

export interface SaleChanges {
  quantity?: number;
  paymentMethod?: string;
  appliedPrice?: number;
}

/**
 * Updates an editable sale's fields and recomputes profit using the frozen
 * costAtSale already stored on the row (never recalculated from the catalog).
 *
 * Note: the linked saleSessions row (amountReceived/change) is intentionally
 * NOT recomputed here — it is a historical snapshot of what was collected at
 * checkout, not a live total. Same applies to cancelSale/restoreSale.
 */
export async function updateSale(id: number, changes: SaleChanges): Promise<void> {
  const [current] = await db
    .select({
      quantity: sales.quantity,
      appliedPrice: sales.appliedPrice,
      costAtSale: sales.costAtSale,
    })
    .from(sales)
    .where(eq(sales.id, id));

  if (!current) return;

  const quantity = changes.quantity ?? current.quantity;
  const appliedPrice = changes.appliedPrice ?? current.appliedPrice;
  const profit = (appliedPrice - current.costAtSale) * quantity;

  await db
    .update(sales)
    .set({
      quantity,
      appliedPrice,
      paymentMethod: changes.paymentMethod ?? undefined,
      profit,
    })
    .where(eq(sales.id, id));
}
