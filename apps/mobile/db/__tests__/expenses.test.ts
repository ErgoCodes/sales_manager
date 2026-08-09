import { eq } from 'drizzle-orm';

import {
  cancelExpense,
  getExpenseById,
  listExpenses,
  registerExpense,
  restoreExpense,
  sumExpenses,
  updateExpense,
} from '../expenses';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { getDb } from '../client';
import { expenses } from '../schema';
import { resetDb, seedExpense } from './helpers';

describe('db/expenses', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('registerExpense', () => {
    it('inserts a new expense row', async () => {
      await registerExpense({ type: 'salario', concept: 'Pago empleado', amount: 500, date: '2026-07-05T10:00:00Z' });

      const rows = getDb().select().from(expenses).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'salario', concept: 'Pago empleado', amount: 500 });
    });
  });

  describe('updateExpense / getExpenseById', () => {
    it('updates only the provided fields', async () => {
      const id = seedExpense({ type: 'multa', amount: 200, concept: 'Original' });

      await updateExpense(id, { amount: 350 });

      const record = await getExpenseById(id);
      expect(record).toMatchObject({ type: 'multa', concept: 'Original', amount: 350 });
    });
  });

  describe('cancelExpense / restoreExpense', () => {
    it('marks the expense cancelled and excludes it from listing and sum, then restores it', async () => {
      const id = seedExpense({ amount: 500, date: '2026-07-05T10:00:00Z' });

      await cancelExpense(id);
      expect(await listExpenses()).toHaveLength(0);
      expect(await sumExpenses()).toBe(0);

      await restoreExpense(id);
      expect(await listExpenses()).toHaveLength(1);
      expect(await sumExpenses()).toBe(500);
    });
  });

  describe('listExpenses / sumExpenses', () => {
    it('filters by date range', async () => {
      seedExpense({ type: 'salario', concept: 'Pago empleado', amount: 500, date: '2026-07-05T10:00:00Z' });
      seedExpense({ type: 'multa', concept: 'Multa tránsito', amount: 200, date: '2026-06-15T10:00:00Z' });

      const monthStart = '2026-07-01';
      const monthEnd = '2026-07-31';

      const expList = await listExpenses({ dateFrom: monthStart, dateTo: monthEnd });
      expect(expList).toHaveLength(1);
      expect(expList[0].concept).toBe('Pago empleado');

      const expSum = await sumExpenses(monthStart, monthEnd);
      expect(expSum).toBe(500);
    });

    it('excludes cancelled expenses from the sum', async () => {
      seedExpense({ amount: 500, date: '2026-07-05T10:00:00Z', cancelled: true });
      seedExpense({ amount: 300, date: '2026-07-06T10:00:00Z' });

      expect(await sumExpenses()).toBe(300);
    });
  });
});
