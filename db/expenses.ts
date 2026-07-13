import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from './client';
import { expenses } from './schema';

interface ExpenseData {
  /** 'salario' | 'multa' | 'onat' */
  type: string;
  concept?: string | null;
  amount: number;
  date: string;
}

/** Registra un gasto periódico (salario, multa, ONAT) — T-14. */
export async function registerExpense(data: ExpenseData): Promise<void> {
  await db.insert(expenses).values({
    type: data.type,
    concept: data.concept ?? null,
    amount: data.amount,
    date: data.date,
  });
}

/** Actualiza los campos editables de un gasto existente (T-15). */
export async function updateExpense(
  id: number,
  data: Partial<{ type: string; concept: string | null; amount: number; date: string }>,
): Promise<void> {
  await db.update(expenses).set(data).where(eq(expenses.id, id));
}

/** Devuelve un gasto por su id (para edición). */
export async function getExpenseById(id: number) {
  const [row] = await db
    .select({
      id: expenses.id,
      type: expenses.type,
      concept: expenses.concept,
      amount: expenses.amount,
      date: expenses.date,
      cancelled: expenses.cancelled,
    })
    .from(expenses)
    .where(eq(expenses.id, id));
  return row ?? null;
}

/** Soft-delete: marca el gasto como anulado (T-15). */
export async function cancelExpense(id: number): Promise<void> {
  await db.update(expenses).set({ cancelled: true }).where(eq(expenses.id, id));
}

/** Restaura un gasto anulado (undo). */
export async function restoreExpense(id: number): Promise<void> {
  await db.update(expenses).set({ cancelled: false }).where(eq(expenses.id, id));
}

export interface ExpenseRecord {
  id: number;
  type: string;
  concept: string | null;
  amount: number;
  date: string;
  cancelled: boolean;
}

interface ListExpensesOptions {
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  includeCancelled?: boolean;
}

export async function listExpenses(
  opts: ListExpensesOptions = {},
): Promise<ExpenseRecord[]> {
  const conditions = [];
  if (!opts.includeCancelled) conditions.push(eq(expenses.cancelled, false));
  if (opts.type) conditions.push(eq(expenses.type, opts.type));
  if (opts.dateFrom)
    conditions.push(sql`date(${expenses.date}) >= date(${opts.dateFrom})`);
  if (opts.dateTo)
    conditions.push(sql`date(${expenses.date}) <= date(${opts.dateTo})`);

  return db
    .select({
      id: expenses.id,
      type: expenses.type,
      concept: expenses.concept,
      amount: expenses.amount,
      date: expenses.date,
      cancelled: expenses.cancelled,
    })
    .from(expenses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(expenses.date));
}

/** Suma de gastos en un rango de fechas (para el total del período). */
export async function sumExpenses(dateFrom?: string, dateTo?: string): Promise<number> {
  const conditions = [eq(expenses.cancelled, false)];
  if (dateFrom) conditions.push(sql`date(${expenses.date}) >= date(${dateFrom})`);
  if (dateTo) conditions.push(sql`date(${expenses.date}) <= date(${dateTo})`);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` })
    .from(expenses)
    .where(and(...conditions));

  return row?.total ?? 0;
}
