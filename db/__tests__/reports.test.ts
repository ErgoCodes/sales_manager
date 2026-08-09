import {
  getDailyBreakdown,
  getDailySummary,
  getDailyTotalsInRange,
  getLossesBreakdown,
  getRangeBreakdown,
  getRangeRanking,
  getRangeSummary,
} from '../queries';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { resetDb, seedExpense, seedOutflow, seedProduct, seedSale } from './helpers';

describe('db/queries reports', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('getDailySummary', () => {
    it('splits revenue and profit by payment method for the given date', async () => {
      const productId = seedProduct();
      seedSale(productId, { paymentMethod: 'efectivo', appliedPrice: 60, quantity: 1, profit: 15, date: '2026-07-19T10:00:00Z' });
      seedSale(productId, { paymentMethod: 'transferencia', appliedPrice: 66, quantity: 1, profit: 21, date: '2026-07-19T11:00:00Z' });

      const summary = await getDailySummary('2026-07-19');
      expect(summary.cash).toBe(60);
      expect(summary.transfer).toBe(66);
      expect(summary.total).toBe(126);
      expect(summary.profit).toBe(36);
    });

    it('excludes cancelled sales and sales from other dates', async () => {
      const productId = seedProduct();
      seedSale(productId, { appliedPrice: 60, quantity: 1, date: '2026-07-19T10:00:00Z', cancelled: true });
      seedSale(productId, { appliedPrice: 60, quantity: 1, date: '2026-07-20T10:00:00Z' });

      const summary = await getDailySummary('2026-07-19');
      expect(summary.total).toBe(0);
    });
  });

  describe('getDailyBreakdown', () => {
    it('aggregates quantity/revenue/profit per product for the given date', async () => {
      const productA = seedProduct({ name: 'A' });
      const productB = seedProduct({ name: 'B' });
      seedSale(productA, { quantity: 2, appliedPrice: 60, profit: 30, date: '2026-07-19T10:00:00Z' });
      seedSale(productB, { quantity: 1, appliedPrice: 100, profit: 40, date: '2026-07-19T11:00:00Z' });
      // Different day, excluded.
      seedSale(productA, { quantity: 5, appliedPrice: 60, profit: 75, date: '2026-07-20T10:00:00Z' });

      const rows = await getDailyBreakdown('2026-07-19');
      expect(rows).toHaveLength(2);
      const byProduct = new Map(rows.map((r) => [r.productId, r]));
      expect(byProduct.get(productA)).toMatchObject({ totalQuantity: 2, totalRevenue: 120, totalProfit: 30 });
      expect(byProduct.get(productB)).toMatchObject({ totalQuantity: 1, totalRevenue: 100, totalProfit: 40 });
    });

    it('filters by payment method when provided', async () => {
      const productId = seedProduct();
      seedSale(productId, { paymentMethod: 'efectivo', quantity: 1, appliedPrice: 60, date: '2026-07-19T10:00:00Z' });
      seedSale(productId, { paymentMethod: 'transferencia', quantity: 1, appliedPrice: 66, date: '2026-07-19T11:00:00Z' });

      const rows = await getDailyBreakdown('2026-07-19', 'efectivo');
      expect(rows).toHaveLength(1);
      expect(rows[0].totalRevenue).toBe(60);
    });
  });

  describe('getRangeSummary / getRangeBreakdown', () => {
    it('includes both range endpoints (inclusive) and excludes dates outside the range', async () => {
      const productId = seedProduct();
      seedSale(productId, { appliedPrice: 60, quantity: 1, profit: 15, date: '2026-07-01T00:00:00Z' });
      seedSale(productId, { appliedPrice: 60, quantity: 1, profit: 15, date: '2026-07-31T23:59:59Z' });
      seedSale(productId, { appliedPrice: 60, quantity: 1, profit: 15, date: '2026-08-01T00:00:00Z' });

      const summary = await getRangeSummary('2026-07-01', '2026-07-31');
      expect(summary.total).toBe(120);

      const breakdown = await getRangeBreakdown('2026-07-01', '2026-07-31');
      expect(breakdown).toHaveLength(1);
      expect(breakdown[0].totalQuantity).toBe(2);
    });
  });

  describe('getDailyTotalsInRange', () => {
    it('returns one row per day with sales, omitting days without any', async () => {
      const productId = seedProduct();
      seedSale(productId, { paymentMethod: 'efectivo', appliedPrice: 60, quantity: 1, profit: 15, date: '2026-07-01T10:00:00Z' });
      seedSale(productId, { paymentMethod: 'transferencia', appliedPrice: 66, quantity: 1, profit: 21, date: '2026-07-03T10:00:00Z' });

      const days = await getDailyTotalsInRange('2026-07-01', '2026-07-31');
      expect(days).toHaveLength(2);
      expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-03']);
      expect(days[0]).toMatchObject({ cash: 60, transfer: 0, total: 60, profit: 15 });
      expect(days[1]).toMatchObject({ cash: 0, transfer: 66, total: 66, profit: 21 });
    });
  });

  describe('getRangeRanking', () => {
    it('orders by quantity or by profit, producing different rankings for the same dataset', async () => {
      const productA = seedProduct({ name: 'A' });
      const productB = seedProduct({ name: 'B' });
      // A sells more units but is less profitable overall.
      seedSale(productA, { quantity: 10, appliedPrice: 10, profit: 10, date: '2026-07-01T10:00:00Z' });
      seedSale(productB, { quantity: 2, appliedPrice: 100, profit: 150, date: '2026-07-01T11:00:00Z' });

      const byQuantity = await getRangeRanking('2026-07-01', '2026-07-31', 'quantity');
      expect(byQuantity[0].productId).toBe(productA);

      const byProfit = await getRangeRanking('2026-07-01', '2026-07-31', 'profit');
      expect(byProfit[0].productId).toBe(productB);
    });

    it('computes margin as profit / revenue, 0 when there was no revenue', async () => {
      const productId = seedProduct();
      seedSale(productId, { quantity: 2, appliedPrice: 50, profit: 30, date: '2026-07-01T10:00:00Z' });

      const [ranking] = await getRangeRanking('2026-07-01', '2026-07-31', 'quantity');
      expect(ranking.totalRevenue).toBe(100);
      expect(ranking.margin).toBeCloseTo(0.3, 5);
    });
  });

  describe('getLossesBreakdown', () => {
    it('always returns all six categories, even when empty', async () => {
      const { categories, total } = await getLossesBreakdown('2026-07-01', '2026-07-31');
      expect(categories).toHaveLength(6);
      expect(categories.map((c) => c.type)).toEqual([
        'retiro_owner',
        'merma',
        'salario',
        'multa',
        'onat',
        'rebaja_liquidacion',
      ]);
      expect(categories.every((c) => c.subtotal === 0 && c.records.length === 0)).toBe(true);
      expect(total).toBe(0);
    });

    it('values movement-based losses at cost, excludes ajuste, and totals equal the sum of subtotals', async () => {
      const productId = seedProduct({ name: 'Producto' });
      seedOutflow(productId, { type: 'merma', quantity: 2, unitCostPrice: 100, date: '2026-07-10T10:00:00Z' });
      seedOutflow(productId, { type: 'retiro_owner', quantity: 1, unitCostPrice: 100, date: '2026-07-11T10:00:00Z' });
      seedOutflow(productId, { type: 'ajuste', quantity: -5, unitCostPrice: 100, date: '2026-07-12T10:00:00Z' });
      seedExpense({ type: 'salario', amount: 500, date: '2026-07-05T10:00:00Z' });

      const { categories, total } = await getLossesBreakdown('2026-07-01', '2026-07-31');
      const byType = new Map(categories.map((c) => [c.type, c]));

      expect(byType.get('merma')?.subtotal).toBe(200);
      expect(byType.get('retiro_owner')?.subtotal).toBe(100);
      expect(byType.get('salario')?.subtotal).toBe(500);
      expect(total).toBe(800);
    });

    it('labels an expense without a concept as "Gasto"', async () => {
      seedExpense({ type: 'multa', amount: 100, concept: null, date: '2026-07-05T10:00:00Z' });

      const { categories } = await getLossesBreakdown('2026-07-01', '2026-07-31');
      const multaCategory = categories.find((c) => c.type === 'multa');
      expect(multaCategory?.records[0].label).toBe('Gasto');
    });
  });
});
