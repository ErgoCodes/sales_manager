import {
  calculateAllStocks,
  calculateStock,
  countLowStock,
  getLastSaleDate,
  getLastSaleDates,
  recalculateAverageCost,
  recalculateAverageCostFromScratch,
} from '../queries';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { CONFIG_KEYS, setConfig } from '../config';
import { resetDb, seedEntry, seedOutflow, seedProduct, seedSale } from './helpers';

describe('db/queries', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('recalculateAverageCost', () => {
    it('calculates average cost correctly (4u * 100 + 10u * 130 -> 121.43)', async () => {
      const productId = seedProduct({ averageCost: 100, costPrice: 100 });
      seedEntry(productId, { quantity: 4, unitCostPrice: 100 });

      const newCost = await recalculateAverageCost(productId, 10, 130);

      // (4 * 100 + 10 * 130) / 14 = 1700 / 14 = 121.4285714...
      expect(newCost).toBeCloseTo(121.42857, 5);
    });

    it('uses costPrice when averageCost is 0 and does not dilute to 0', async () => {
      const productId = seedProduct({ averageCost: 0, costPrice: 45 });
      // Stock of 10 was added previously without updating averageCost
      seedEntry(productId, { quantity: 10, unitCostPrice: 45 });

      const newCost = await recalculateAverageCost(productId, 10, 45);
      // (10 * 45 + 10 * 45) / 20 = 45 (not 22.50)
      expect(newCost).toBe(45);
    });

    it('takes the new cost if denominator is <= 0 (stock is 0)', async () => {
      const productId = seedProduct({ averageCost: 50, costPrice: null });

      const newCost = await recalculateAverageCost(productId, 10, 130);
      expect(newCost).toBe(130);
    });
  });

  describe('recalculateAverageCostFromScratch', () => {
    it('falls back to costPrice when there are no active entries', async () => {
      const productId = seedProduct({ costPrice: 45, averageCost: 0 });

      const avg = await recalculateAverageCostFromScratch(productId);
      expect(avg).toBe(45);
    });

    it('excludes cancelled entries from the weighted average', async () => {
      const productId = seedProduct({ costPrice: 10, averageCost: 0 });
      seedEntry(productId, { quantity: 10, unitCostPrice: 10 });
      // Cancelled entry with a wildly different cost must not affect the average.
      seedEntry(productId, { quantity: 100, unitCostPrice: 999, cancelled: true });

      const avg = await recalculateAverageCostFromScratch(productId);
      expect(avg).toBe(10);
    });

    it('returns 0 when total active quantity is zero despite having entry rows', async () => {
      const productId = seedProduct({ costPrice: 10, averageCost: 0 });
      seedEntry(productId, { quantity: 5, unitCostPrice: 10 });
      seedEntry(productId, { quantity: -5, unitCostPrice: 20 });

      const avg = await recalculateAverageCostFromScratch(productId);
      expect(avg).toBe(0);
    });

    it('computes the same weighted average as the incremental version across multiple entries', async () => {
      const productId = seedProduct({ costPrice: 100, averageCost: 0 });
      seedEntry(productId, { quantity: 4, unitCostPrice: 100, date: '2026-07-01T10:00:00Z' });
      seedEntry(productId, { quantity: 10, unitCostPrice: 130, date: '2026-07-02T10:00:00Z' });

      const avg = await recalculateAverageCostFromScratch(productId);
      expect(avg).toBeCloseTo(121.42857, 5);
    });
  });

  describe('calculateStock', () => {
    it('derives stock from entrada/merma/retiro_owner/ajuste and non-cancelled sales', async () => {
      const productId = seedProduct();

      seedEntry(productId, { quantity: 10, date: '2026-07-01T10:00:00Z' });
      seedOutflow(productId, { type: 'merma', quantity: 2, date: '2026-07-02T10:00:00Z' });
      seedOutflow(productId, { type: 'retiro_owner', quantity: 1, date: '2026-07-02T11:00:00Z' });
      seedOutflow(productId, { type: 'ajuste', quantity: -1, date: '2026-07-03T10:00:00Z' });
      seedSale(productId, { quantity: 3, date: '2026-07-04T10:00:00Z' });
      // Cancelled sale should not deduct.
      seedSale(productId, { quantity: 5, date: '2026-07-05T10:00:00Z', cancelled: true });

      const stock = await calculateStock(productId);
      // 10 (entrada) - 2 (merma) - 1 (retiro_owner) + (-1) (ajuste) - 3 (sale) = 3
      expect(stock).toBe(3);
    });
  });

  describe('calculateAllStocks', () => {
    it('returns a per-product stock map, combining movements and sales', async () => {
      const productA = seedProduct({ name: 'A' });
      const productB = seedProduct({ name: 'B' });

      seedEntry(productA, { quantity: 10 });
      seedSale(productA, { quantity: 4 });

      seedEntry(productB, { quantity: 5 });

      const stocks = await calculateAllStocks();
      expect(stocks.get(productA)).toBe(6);
      expect(stocks.get(productB)).toBe(5);
    });
  });

  describe('countLowStock', () => {
    it('counts a product below its own lowStockThreshold', async () => {
      const productId = seedProduct({ lowStockThreshold: 3, category: null });
      seedEntry(productId, { quantity: 2 });

      expect(await countLowStock()).toBe(1);
    });

    it('falls back to the category threshold when the product has no explicit one', async () => {
      // 'Bebidas' has a hardcoded threshold of 24 in drizzle/constants/catalog.ts
      const productId = seedProduct({ lowStockThreshold: null, category: 'Bebidas' });
      seedEntry(productId, { quantity: 20 });

      expect(await countLowStock()).toBe(1);
    });

    it('falls back to the general config threshold (default 5) when no product/category threshold applies', async () => {
      const productId = seedProduct({ lowStockThreshold: null, category: null });
      seedEntry(productId, { quantity: 4 });

      expect(await countLowStock()).toBe(1);
    });

    it('uses the configured general threshold instead of the default when set', async () => {
      await setConfig(CONFIG_KEYS.generalStockThreshold, '10');
      const productId = seedProduct({ lowStockThreshold: null, category: null });
      seedEntry(productId, { quantity: 8 });

      expect(await countLowStock()).toBe(1);
    });

    it('excludes archived products even if their stock is below threshold', async () => {
      seedProduct({ lowStockThreshold: 100, active: false });

      expect(await countLowStock()).toBe(0);
    });

    it('does not count a product with stock at or above its threshold', async () => {
      const productId = seedProduct({ lowStockThreshold: 5 });
      seedEntry(productId, { quantity: 5 });

      expect(await countLowStock()).toBe(0);
    });
  });

  describe('getLastSaleDate / getLastSaleDates', () => {
    it('returns the most recent non-cancelled sale date, ignoring cancelled sales', async () => {
      const productId = seedProduct();
      seedSale(productId, { date: '2026-07-01T10:00:00Z' });
      seedSale(productId, { date: '2026-07-10T10:00:00Z', cancelled: true });
      seedSale(productId, { date: '2026-07-05T10:00:00Z' });

      expect(await getLastSaleDate(productId)).toBe('2026-07-05T10:00:00Z');
    });

    it('returns null when a product has no sales', async () => {
      const productId = seedProduct();
      expect(await getLastSaleDate(productId)).toBeNull();
    });

    it('returns a map with the last sale date per product', async () => {
      const productA = seedProduct({ name: 'A' });
      const productB = seedProduct({ name: 'B' });
      seedSale(productA, { date: '2026-07-01T10:00:00Z' });
      seedSale(productA, { date: '2026-07-03T10:00:00Z' });
      seedSale(productB, { date: '2026-07-02T10:00:00Z' });

      const map = await getLastSaleDates();
      expect(map.get(productA)).toBe('2026-07-03T10:00:00Z');
      expect(map.get(productB)).toBe('2026-07-02T10:00:00Z');
    });
  });
});
