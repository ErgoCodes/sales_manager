import { and, eq, like } from 'drizzle-orm';

import { db } from './client';
import { calculateAllStocks } from './queries';
import { type NewProduct, type Product, products } from './schema';

export type ProductWithStock = Product & { stock: number };

export type ProductData = Pick<
  NewProduct,
  | 'name'
  | 'unitOfMeasure'
  | 'category'
  | 'lowStockThreshold'
  | 'costPrice'
  | 'cashPrice'
  | 'transferPrice'
  | 'expirationDate'
>;

interface ListOptions {
  search?: string;
  category?: string;
  includeArchived?: boolean;
}

export async function listProducts(opts: ListOptions = {}): Promise<ProductWithStock[]> {
  const conditions = [];
  if (!opts.includeArchived) conditions.push(eq(products.active, true));
  if (opts.search?.trim()) conditions.push(like(products.name, `%${opts.search.trim()}%`));
  if (opts.category) conditions.push(eq(products.category, opts.category));

  const rows = await db
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(products.name);

  const stockMap = await calculateAllStocks();
  return rows.map((p) => ({ ...p, stock: stockMap.get(p.id) ?? 0 }));
}

export async function getProduct(id: number): Promise<Product | undefined> {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}

export async function createProduct(data: ProductData): Promise<number> {
  const [row] = await db
    .insert(products)
    .values({
      ...data,
      averageCost: data.costPrice ?? 0,
    })
    .returning({ id: products.id });
  return row.id;
}

export async function updateProduct(id: number, data: ProductData): Promise<void> {
  await db.update(products).set(data).where(eq(products.id, id));
}

export async function archiveProduct(id: number): Promise<void> {
  await db.update(products).set({ active: false }).where(eq(products.id, id));
}

export async function restoreProduct(id: number): Promise<void> {
  await db.update(products).set({ active: true }).where(eq(products.id, id));
}
