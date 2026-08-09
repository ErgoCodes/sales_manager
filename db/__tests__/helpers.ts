import { db } from '../client';
import {
  configuration,
  expenses,
  products,
  saleSessions,
  sales,
  warehouseMovements,
} from '../schema';

/**
 * Call this from `db` import must already be mocked (each test file needs its
 * own `jest.mock('../client')` before importing this helper — Jest hoists
 * mocks per-file, so it can't be centralized here).
 */
export function resetDb() {
  db.delete(sales).run();
  db.delete(saleSessions).run();
  db.delete(warehouseMovements).run();
  db.delete(expenses).run();
  db.delete(products).run();
  db.delete(configuration).run();
}

type ProductOverrides = Partial<{
  id: number;
  name: string;
  category: string | null;
  unitOfMeasure: string;
  costPrice: number | null;
  cashPrice: number | null;
  transferPrice: number | null;
  averageCost: number;
  lowStockThreshold: number | null;
  expirationDate: string | null;
  active: boolean;
}>;

export function seedProduct(overrides: ProductOverrides = {}): number {
  const [row] = db
    .insert(products)
    .values({
      name: 'Producto Test',
      category: 'Bebidas',
      unitOfMeasure: 'u',
      costPrice: 45,
      averageCost: 45,
      cashPrice: 60,
      transferPrice: 60,
      lowStockThreshold: 5,
      ...overrides,
    })
    .returning({ id: products.id })
    .all();
  return row.id;
}

type EntryOverrides = Partial<{
  quantity: number;
  unitCostPrice: number;
  date: string;
  salePrice: number | null;
  notes: string | null;
  cancelled: boolean;
}>;

export function seedEntry(productId: number, overrides: EntryOverrides = {}): number {
  const [row] = db
    .insert(warehouseMovements)
    .values({
      productId,
      type: 'entrada',
      quantity: 10,
      unitCostPrice: 10,
      date: '2026-07-01T10:00:00Z',
      ...overrides,
    })
    .returning({ id: warehouseMovements.id })
    .all();
  return row.id;
}

type OutflowOverrides = Partial<{
  type: string;
  quantity: number;
  unitCostPrice: number;
  date: string;
  notes: string | null;
  cancelled: boolean;
}>;

export function seedOutflow(productId: number, overrides: OutflowOverrides = {}): number {
  const [row] = db
    .insert(warehouseMovements)
    .values({
      productId,
      type: 'merma',
      quantity: 1,
      unitCostPrice: 10,
      date: '2026-07-01T10:00:00Z',
      ...overrides,
    })
    .returning({ id: warehouseMovements.id })
    .all();
  return row.id;
}

type SaleOverrides = Partial<{
  quantity: number;
  appliedPrice: number;
  paymentMethod: string;
  costAtSale: number;
  profit: number;
  date: string;
  discountPercent: number;
  isCostSale: boolean;
  cancelled: boolean;
  sessionId: number | null;
}>;

export function seedSale(productId: number, overrides: SaleOverrides = {}): number {
  const [row] = db
    .insert(sales)
    .values({
      productId,
      quantity: 1,
      appliedPrice: 60,
      paymentMethod: 'efectivo',
      costAtSale: 45,
      profit: 15,
      date: '2026-07-01T10:00:00Z',
      ...overrides,
    })
    .returning({ id: sales.id })
    .all();
  return row.id;
}

type ExpenseOverrides = Partial<{
  type: string;
  concept: string | null;
  amount: number;
  date: string;
  cancelled: boolean;
}>;

export function seedExpense(overrides: ExpenseOverrides = {}): number {
  const [row] = db
    .insert(expenses)
    .values({
      type: 'salario',
      amount: 100,
      date: '2026-07-01T10:00:00Z',
      ...overrides,
    })
    .returning({ id: expenses.id })
    .all();
  return row.id;
}
