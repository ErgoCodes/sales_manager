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

export interface ExpenseRecord {
  id: number;
  type: string;
  concept: string | null;
  amount: number;
  date: string;
}

interface ListExpensesOptions {
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listExpenses(
  opts: ListExpensesOptions = {},
): Promise<ExpenseRecord[]> {
  const conditions = [];
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
    })
    .from(expenses)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(expenses.date));
}

/** Suma de gastos en un rango de fechas (para el total del período). */
export async function sumExpenses(dateFrom?: string, dateTo?: string): Promise<number> {
  const conditions = [];
  if (dateFrom) conditions.push(sql`date(${expenses.date}) >= date(${dateFrom})`);
  if (dateTo) conditions.push(sql`date(${expenses.date}) <= date(${dateTo})`);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)` })
    .from(expenses)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return row?.total ?? 0;
}
