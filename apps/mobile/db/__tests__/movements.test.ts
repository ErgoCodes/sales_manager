import { eq } from 'drizzle-orm';

import {
  cancelEntry,
  cancelOutflow,
  getEntriesSummaryByProduct,
  getEntryById,
  getOutflowById,
  listEntries,
  listMovements,
  registerEntry,
  registerOutflow,
  restoreEntry,
  restoreOutflow,
  sumLossOutflowsValue,
  updateEntry,
  updateOutflow,
} from '../movements';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { db } from '../client';
import { calculateStock } from '../queries';
import { products, warehouseMovements } from '../schema';
import { resetDb, seedEntry, seedOutflow, seedProduct } from './helpers';

describe('db/movements', () => {
  beforeEach(() => {
    resetDb();
  });

  describe('registerEntry', () => {
    it('sets average cost to the entry cost on the very first entry (not halved)', async () => {
      const productId = seedProduct({ averageCost: 0 });

      await registerEntry({
        productId,
        quantity: 10,
        unitCostPrice: 100,
        date: '2026-07-01T10:00:00Z',
      });

      const [product] = db.select().from(products).where(eq(products.id, productId)).all();
      expect(product.averageCost).toBe(100);
    });

    it('weights a second entry against the pre-existing stock (4u * 100 + 10u * 130 -> 121.43)', async () => {
      const productId = seedProduct({ averageCost: 100 });
      seedEntry(productId, { quantity: 4, unitCostPrice: 100, date: '2026-07-01T10:00:00Z' });

      await registerEntry({
        productId,
        quantity: 10,
        unitCostPrice: 130,
        date: '2026-07-02T10:00:00Z',
      });

      const [product] = db.select().from(products).where(eq(products.id, productId)).all();
      expect(product.averageCost).toBeCloseTo(121.42857, 5);
    });
  });

  describe('updateEntry', () => {
    it('recalculates averageCost from scratch and updates stock after changing quantity and cost', async () => {
      const productId = seedProduct({ averageCost: 100 });
      const entryId = seedEntry(productId, { quantity: 4, unitCostPrice: 100, date: '2026-07-01T10:00:00Z' });

      await updateEntry(entryId, {
        productId,
        quantity: 10,
        unitCostPrice: 130,
        date: '2026-07-01T10:00:00Z',
      });

      const [product] = db.select().from(products).where(eq(products.id, productId)).all();
      expect(product.averageCost).toBe(130);
      expect(await calculateStock(productId)).toBe(10);
    });
  });

  describe('cancelEntry / restoreEntry', () => {
    it('excludes a cancelled entry from stock and averageCost, then restores it exactly', async () => {
      const productId = seedProduct({ averageCost: 0, costPrice: 50 });
      seedEntry(productId, { quantity: 4, unitCostPrice: 100, date: '2026-07-01T10:00:00Z' });
      const secondEntryId = seedEntry(productId, { quantity: 10, unitCostPrice: 130, date: '2026-07-02T10:00:00Z' });

      await cancelEntry(secondEntryId);
      expect(await calculateStock(productId)).toBe(4);
      let [product] = db.select().from(products).where(eq(products.id, productId)).all();
      expect(product.averageCost).toBe(100);

      await restoreEntry(secondEntryId);
      expect(await calculateStock(productId)).toBe(14);
      [product] = db.select().from(products).where(eq(products.id, productId)).all();
      expect(product.averageCost).toBeCloseTo(121.42857, 5);
    });

    it('is a no-op when cancelling an entry id that does not exist', async () => {
      await expect(cancelEntry(9999)).resolves.toBeUndefined();
    });
  });

  describe('updateOutflow / cancelOutflow', () => {
    it('reflects quantity changes in stock', async () => {
      const productId = seedProduct();
      seedEntry(productId, { quantity: 10 });
      const outflowId = seedOutflow(productId, { type: 'merma', quantity: 2, unitCostPrice: 10 });

      expect(await calculateStock(productId)).toBe(8);

      await updateOutflow(outflowId, { quantity: 5 });
      expect(await calculateStock(productId)).toBe(5);
    });

    it('excludes a cancelled outflow from stock and loss totals', async () => {
      const productId = seedProduct();
      seedEntry(productId, { quantity: 10 });
      const outflowId = seedOutflow(productId, {
        type: 'merma',
        quantity: 2,
        unitCostPrice: 10,
        date: '2026-07-02T10:00:00Z',
      });

      expect(await sumLossOutflowsValue('2026-07-01', '2026-07-31')).toBe(20);

      await cancelOutflow(outflowId);
      expect(await calculateStock(productId)).toBe(10);
      expect(await sumLossOutflowsValue('2026-07-01', '2026-07-31')).toBe(0);
    });

    it('restoreOutflow reverts a cancellation exactly', async () => {
      const productId = seedProduct();
      seedEntry(productId, { quantity: 10 });
      const outflowId = seedOutflow(productId, { type: 'merma', quantity: 2, unitCostPrice: 10 });

      await cancelOutflow(outflowId);
      expect(await calculateStock(productId)).toBe(10);

      await restoreOutflow(outflowId);
      expect(await calculateStock(productId)).toBe(8);
    });
  });

  describe('registerOutflow', () => {
    it('inserts the movement without touching averageCost (only entries recalculate it)', async () => {
      const productId = seedProduct({ averageCost: 45 });

      await registerOutflow({
        productId,
        type: 'merma',
        quantity: 2,
        unitCostPrice: 10,
        date: '2026-07-01T10:00:00Z',
      });

      const [product] = db.select().from(products).where(eq(products.id, productId)).all();
      expect(product.averageCost).toBe(45);
      expect(await calculateStock(productId)).toBe(-2);
    });
  });

  describe('getEntryById / getOutflowById', () => {
    it('getEntryById returns the joined entry, and null for a non-entrada movement', async () => {
      const productId = seedProduct({ name: 'Producto' });
      const entryId = seedEntry(productId, { quantity: 5, unitCostPrice: 10 });
      const outflowId = seedOutflow(productId, { type: 'merma', quantity: 1 });

      const entry = await getEntryById(entryId);
      expect(entry).toMatchObject({ productId, productName: 'Producto', quantity: 5 });

      expect(await getEntryById(outflowId)).toBeNull();
    });

    it('getOutflowById returns the joined outflow', async () => {
      const productId = seedProduct({ name: 'Producto' });
      const outflowId = seedOutflow(productId, { type: 'retiro_owner', quantity: 3 });

      const outflow = await getOutflowById(outflowId);
      expect(outflow).toMatchObject({ productId, productName: 'Producto', type: 'retiro_owner', quantity: 3 });
    });
  });

  describe('sumLossOutflowsValue', () => {
    it('excludes ajuste from the loss total', async () => {
      const productId = seedProduct();
      seedOutflow(productId, { type: 'merma', quantity: 2, unitCostPrice: 100, date: '2026-07-15T10:00:00Z' });
      seedOutflow(productId, { type: 'retiro_owner', quantity: 1, unitCostPrice: 100, date: '2026-07-18T10:00:00Z' });
      seedOutflow(productId, { type: 'ajuste', quantity: -5, unitCostPrice: 100, date: '2026-07-16T10:00:00Z' });

      const lossSum = await sumLossOutflowsValue('2026-07-01', '2026-07-31');
      // 2 * 100 (merma) + 1 * 100 (retiro_owner) = 300; ajuste excluded
      expect(lossSum).toBe(300);
    });
  });

  describe('listMovements', () => {
    it('filters by type and date range, ordered by date descending', async () => {
      const productId = seedProduct();
      seedOutflow(productId, { type: 'merma', quantity: 2, date: '2026-07-15T10:00:00Z' });
      seedOutflow(productId, { type: 'retiro_owner', quantity: 1, date: '2026-07-18T10:00:00Z' });
      seedOutflow(productId, { type: 'ajuste', quantity: -5, date: '2026-07-16T10:00:00Z' });
      // Previous month, excluded by the date filter.
      seedOutflow(productId, { type: 'retiro_owner', quantity: 3, date: '2026-06-20T10:00:00Z' });

      const result = await listMovements({
        types: ['merma', 'retiro_owner'],
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
      });

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.type)).toEqual(['retiro_owner', 'merma']);
    });
  });

  describe('getEntriesSummaryByProduct', () => {
    it('aggregates entries by product and excludes cancelled entries', async () => {
      const productA = seedProduct({ name: 'Producto A' });
      const productB = seedProduct({ name: 'Producto B', unitOfMeasure: 'kg' });

      seedEntry(productA, { quantity: 5, unitCostPrice: 100, date: '2026-07-10T08:00:00Z' });
      seedEntry(productA, { quantity: 15, unitCostPrice: 100, date: '2026-07-15T10:00:00Z' });
      // Cancelled entry for product A - should be excluded.
      seedEntry(productA, { quantity: 100, unitCostPrice: 100, date: '2026-07-12T10:00:00Z', cancelled: true });
      seedEntry(productB, { quantity: 10, unitCostPrice: 50, date: '2026-07-14T09:00:00Z' });

      const summary = await getEntriesSummaryByProduct('2026-07-01', '2026-07-31');

      expect(summary).toHaveLength(2);
      // Product A total value = (5*100) + (15*100) = 2000. Product B = 10*50 = 500.
      expect(summary[0]).toMatchObject({
        productId: productA,
        productName: 'Producto A',
        totalQuantity: 20,
        totalCostValue: 2000,
        entriesCount: 2,
        lastEntryDate: '2026-07-15T10:00:00Z',
      });
      expect(summary[1]).toMatchObject({
        productId: productB,
        productName: 'Producto B',
        totalQuantity: 10,
        totalCostValue: 500,
        entriesCount: 1,
      });
    });

    it('filters entries strictly by date range', async () => {
      const productId = seedProduct();
      seedEntry(productId, { quantity: 10, unitCostPrice: 10, date: '2026-06-30T23:59:59Z' });
      seedEntry(productId, { quantity: 5, unitCostPrice: 10, date: '2026-07-05T10:00:00Z' });
      seedEntry(productId, { quantity: 8, unitCostPrice: 10, date: '2026-08-01T00:00:00Z' });

      const summary = await getEntriesSummaryByProduct('2026-07-01', '2026-07-31');
      expect(summary).toHaveLength(1);
      expect(summary[0].totalQuantity).toBe(5);
      expect(summary[0].totalCostValue).toBe(50);
    });
  });

  describe('listEntries', () => {
    it('excludes cancelled entries', async () => {
      const productId = seedProduct();
      seedEntry(productId, { quantity: 5, date: '2026-07-05T10:00:00Z', cancelled: false });
      seedEntry(productId, { quantity: 20, date: '2026-07-06T10:00:00Z', cancelled: true });

      const entries = await listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].quantity).toBe(5);
    });
  });
});
