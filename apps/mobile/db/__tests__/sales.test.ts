import { eq } from 'drizzle-orm';

import {
  cancelSale,
  listSales,
  registerSalesSession,
  restoreSale,
  runAverageCostBackfill,
  updateSale,
  verifySessionStock,
} from '../sales';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { getDb } from '../client';
import { calculateStock, getDailySummary } from '../queries';
import { products, saleSessions, sales } from '../schema';
import { resetDb, seedEntry, seedProduct, seedSale } from './helpers';

function cartItem(overrides: Partial<Parameters<typeof registerSalesSession>[0][number]> = {}) {
  return {
    productId: 1,
    key: 'item-1',
    name: 'Producto',
    unitOfMeasure: 'u',
    quantity: 1,
    appliedPrice: 60,
    paymentMethod: 'efectivo' as const,
    isCostSale: false,
    discountPercent: 0,
    costAtSale: 45,
    profit: 15,
    ...overrides,
  };
}

describe('db/sales', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('registerSalesSession', () => {
    it('inserts one row per cart line, all sharing the same date', () => {
      const productId = seedProduct({ costPrice: 45, cashPrice: 60 });

      registerSalesSession(
        [
          cartItem({ productId, key: 'a', quantity: 1 }),
          cartItem({ productId, key: 'b', quantity: 2 }),
        ],
        '2026-07-19T12:00:00Z',
      );

      const rows = getDb().select().from(sales).all();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.date === '2026-07-19T12:00:00Z')).toBe(true);
    });

    it('calculates profit using the catalog costPrice, not the costAtSale carried in the cart item', () => {
      const productId = seedProduct({ costPrice: 45, averageCost: 0, cashPrice: 60 });

      registerSalesSession(
        [cartItem({ productId, appliedPrice: 60, quantity: 1, costAtSale: 999 })],
        '2026-07-19T12:00:00Z',
      );

      const [row] = getDb().select().from(sales).all();
      expect(row.costAtSale).toBe(45);
      expect(row.profit).toBe(15);
    });

    it('rolls back the whole transaction when one line references a non-existent product', () => {
      const productId = seedProduct({ costPrice: 45, cashPrice: 60 });

      expect(() =>
        registerSalesSession(
          [
            cartItem({ productId, key: 'a' }),
            cartItem({ productId: 9999, key: 'b' }),
          ],
          '2026-07-19T12:00:00Z',
        ),
      ).toThrow('Producto 9999 no encontrado');

      expect(getDb().select().from(sales).all()).toHaveLength(0);
      expect(getDb().select().from(saleSessions).all()).toHaveLength(0);
    });

    it('sets profit to 0 for cost sales even when appliedPrice exceeds costAtSale', () => {
      const productId = seedProduct({ costPrice: 45, cashPrice: 60 });

      registerSalesSession(
        [cartItem({ productId, appliedPrice: 60, isCostSale: true })],
        '2026-07-19T12:00:00Z',
      );

      const [row] = getDb().select().from(sales).all();
      expect(row.profit).toBe(0);
    });

    it('creates a cash session summing only the efectivo lines, with the correct change', () => {
      const productId = seedProduct({ costPrice: 45, cashPrice: 60 });

      const sessionId = registerSalesSession(
        [
          cartItem({ productId, key: 'a', paymentMethod: 'efectivo', appliedPrice: 60, quantity: 1 }),
          cartItem({ productId, key: 'b', paymentMethod: 'transferencia', appliedPrice: 60, quantity: 1 }),
        ],
        '2026-07-19T12:00:00Z',
        { amountReceived: 100 },
      );

      expect(sessionId).toBe(2);

      const [session] = getDb().select().from(saleSessions).all();
      expect(session.cashTotal).toBe(60);
      expect(session.amountReceived).toBe(100);
      expect(session.change).toBe(40);

      const rows = getDb().select().from(sales).all();
      expect(rows.every((r) => r.sessionId === session.id)).toBe(true);
    });

    it('does not create a session when amountReceived is 0, leaving sales with sessionId null', () => {
      const productId = seedProduct({ costPrice: 45, cashPrice: 60 });

      registerSalesSession(
        [cartItem({ productId })],
        '2026-07-19T12:00:00Z',
        { amountReceived: 0 },
      );

      expect(getDb().select().from(saleSessions).all()).toHaveLength(0);
      const [row] = getDb().select().from(sales).all();
      expect(row.sessionId).toBeNull();
    });
  });

  describe('verifySessionStock', () => {
    it('warns when the aggregated cart quantity for a product would exceed current stock', async () => {
      const productId = seedProduct({ name: 'Refresco' });
      seedEntry(productId, { quantity: 5 });

      const warnings = await verifySessionStock([
        cartItem({ productId, key: 'a', quantity: 3, name: 'Refresco' }),
        cartItem({ productId, key: 'b', quantity: 4, name: 'Refresco' }),
      ]);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        name: 'Refresco',
        currentStock: 5,
        quantityToSell: 7,
        resultingStock: -2,
      });
    });

    it('returns no warnings when stock is sufficient', async () => {
      const productId = seedProduct();
      seedEntry(productId, { quantity: 10 });

      const warnings = await verifySessionStock([cartItem({ productId, quantity: 5 })]);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('listSales', () => {
    it('excludes cancelled sales by default and includes them with includeCancelled', async () => {
      const productId = seedProduct();
      seedSale(productId, { cancelled: false });
      seedSale(productId, { cancelled: true });

      expect(await listSales({ productId })).toHaveLength(1);
      expect(await listSales({ productId, includeCancelled: true })).toHaveLength(2);
    });
  });

  describe('updateSale / cancelSale / restoreSale', () => {
    it('recomputes profit using the frozen costAtSale, never re-reading the current catalog price', async () => {
      const productId = seedProduct({ costPrice: 999 });
      const saleId = seedSale(productId, { costAtSale: 45, appliedPrice: 60, quantity: 1 });

      await updateSale(saleId, { quantity: 2 });

      const [row] = getDb().select().from(sales).where(eq(sales.id, saleId)).all();
      expect(row.costAtSale).toBe(45);
      expect(row.profit).toBe((60 - 45) * 2);
    });

    it('keeps profit at 0 for cost sales regardless of the change applied', async () => {
      const productId = seedProduct();
      const saleId = seedSale(productId, { costAtSale: 45, appliedPrice: 45, isCostSale: true, profit: 0 });

      await updateSale(saleId, { quantity: 3 });

      const [row] = getDb().select().from(sales).where(eq(sales.id, saleId)).all();
      expect(row.profit).toBe(0);
    });

    it('is a no-op when the sale id does not exist', async () => {
      await expect(updateSale(9999, { quantity: 5 })).resolves.toBeUndefined();
    });

    it('excludes a cancelled sale from stock and daily totals, and restore brings it back', async () => {
      const productId = seedProduct();
      const saleId = seedSale(productId, {
        quantity: 3,
        appliedPrice: 60,
        profit: 15,
        date: '2026-07-19T10:00:00Z',
      });

      expect(await calculateStock(productId)).toBe(-3);
      expect((await getDailySummary('2026-07-19T10:00:00Z')).total).toBe(180);

      await cancelSale(saleId);
      expect(await calculateStock(productId)).toBe(0);
      expect((await getDailySummary('2026-07-19T10:00:00Z')).total).toBe(0);

      await restoreSale(saleId);
      expect(await calculateStock(productId)).toBe(-3);
      expect((await getDailySummary('2026-07-19T10:00:00Z')).total).toBe(180);
    });
  });

  describe('runAverageCostBackfill', () => {
    it('backfills products with averageCost 0 to costPrice and recalculates legacy sales', async () => {
      const productId = seedProduct({ costPrice: 45, averageCost: 0, cashPrice: 60 });

      // Legacy inflated sale recorded with costAtSale = 22.50 and profit = 37.50
      const saleId = seedSale(productId, {
        quantity: 1,
        appliedPrice: 60,
        costAtSale: 22.5,
        profit: 37.5,
        date: '2026-07-19T10:00:00Z',
      });

      const result = await runAverageCostBackfill();
      expect(result.updatedProducts).toBe(1);
      expect(result.updatedSales).toBe(1);

      const [p] = getDb().select().from(products).where(eq(products.id, productId)).all();
      expect(p.averageCost).toBe(45);

      const [s] = getDb().select().from(sales).where(eq(sales.id, saleId)).all();
      expect(s.costAtSale).toBe(45);
      expect(s.profit).toBe(15);
    });
  });
});
