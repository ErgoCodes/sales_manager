import { getEntriesSummaryByProduct, listEntries, registerEntry } from '../movements';
import { products, warehouseMovements } from '../schema';
import { eq } from 'drizzle-orm';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { db } from '../client';

describe('db/movements', () => {
  beforeEach(() => {
    db.delete(warehouseMovements).run();
    db.delete(products).run();
  });

  describe('registerEntry', () => {
    it('sets average cost to the entry cost on the very first entry (not halved)', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Test Product',
          category: 'Bebidas',
          unitOfMeasure: 'u',
          averageCost: 0,
          cashPrice: 150,
          transferPrice: 150,
          lowStockThreshold: 5,
        })
        .run();

      await registerEntry({
        productId: 1,
        quantity: 10,
        unitCostPrice: 100,
        date: '2026-07-01T10:00:00Z',
      });

      const [product] = await db.select().from(products).where(eq(products.id, 1));
      expect(product.averageCost).toBe(100);
    });

    it('weights a second entry against the pre-existing stock (4u * 100 + 10u * 130 -> 121.43)', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Test Product',
          category: 'Bebidas',
          unitOfMeasure: 'u',
          averageCost: 100,
          cashPrice: 150,
          transferPrice: 150,
          lowStockThreshold: 5,
        })
        .run();

      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'entrada',
          quantity: 4,
          unitCostPrice: 100,
          date: '2026-07-01T10:00:00Z',
        })
        .run();

      await registerEntry({
        productId: 1,
        quantity: 10,
        unitCostPrice: 130,
        date: '2026-07-02T10:00:00Z',
      });

      const [product] = await db.select().from(products).where(eq(products.id, 1));
      expect(product.averageCost).toBeCloseTo(121.42857, 5);
    });
  });

  describe('getEntriesSummaryByProduct', () => {
    it('aggregates entries by product and excludes cancelled entries', async () => {
      db.insert(products)
        .values([
          {
            id: 1,
            name: 'Producto A',
            unitOfMeasure: 'u',
            averageCost: 100,
          },
          {
            id: 2,
            name: 'Producto B',
            unitOfMeasure: 'kg',
            averageCost: 50,
          },
        ])
        .run();

      db.insert(warehouseMovements)
        .values([
          {
            productId: 1,
            type: 'entrada',
            quantity: 5,
            unitCostPrice: 100,
            date: '2026-07-10T08:00:00Z',
            cancelled: false,
          },
          {
            productId: 1,
            type: 'entrada',
            quantity: 15,
            unitCostPrice: 100,
            date: '2026-07-15T10:00:00Z',
            cancelled: false,
          },
          // Cancelled entry for product 1 - should be excluded
          {
            productId: 1,
            type: 'entrada',
            quantity: 100,
            unitCostPrice: 100,
            date: '2026-07-12T10:00:00Z',
            cancelled: true,
          },
          {
            productId: 2,
            type: 'entrada',
            quantity: 10,
            unitCostPrice: 50,
            date: '2026-07-14T09:00:00Z',
            cancelled: false,
          },
        ])
        .run();

      const summary = await getEntriesSummaryByProduct('2026-07-01', '2026-07-31');

      expect(summary).toHaveLength(2);
      // Product 1 total value = (5*100) + (15*100) = 2000. Product 2 = 10*50 = 500.
      // Order should be product 1 first.
      expect(summary[0].productId).toBe(1);
      expect(summary[0].productName).toBe('Producto A');
      expect(summary[0].totalQuantity).toBe(20);
      expect(summary[0].totalCostValue).toBe(2000);
      expect(summary[0].entriesCount).toBe(2);
      expect(summary[0].lastEntryDate).toBe('2026-07-15T10:00:00Z');

      expect(summary[1].productId).toBe(2);
      expect(summary[1].productName).toBe('Producto B');
      expect(summary[1].totalQuantity).toBe(10);
      expect(summary[1].totalCostValue).toBe(500);
      expect(summary[1].entriesCount).toBe(1);
      expect(summary[1].lastEntryDate).toBe('2026-07-14T09:00:00Z');
    });

    it('filters entries strictly by date range', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Producto A',
          unitOfMeasure: 'u',
          averageCost: 10,
        })
        .run();

      db.insert(warehouseMovements)
        .values([
          {
            productId: 1,
            type: 'entrada',
            quantity: 10,
            unitCostPrice: 10,
            date: '2026-06-30T23:59:59Z',
          },
          {
            productId: 1,
            type: 'entrada',
            quantity: 5,
            unitCostPrice: 10,
            date: '2026-07-05T10:00:00Z',
          },
          {
            productId: 1,
            type: 'entrada',
            quantity: 8,
            unitCostPrice: 10,
            date: '2026-08-01T00:00:00Z',
          },
        ])
        .run();

      const summary = await getEntriesSummaryByProduct('2026-07-01', '2026-07-31');
      expect(summary).toHaveLength(1);
      expect(summary[0].totalQuantity).toBe(5);
      expect(summary[0].totalCostValue).toBe(50);
    });
  });

  describe('listEntries', () => {
    it('excludes cancelled entries', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Producto A',
          unitOfMeasure: 'u',
          averageCost: 10,
        })
        .run();

      db.insert(warehouseMovements)
        .values([
          {
            productId: 1,
            type: 'entrada',
            quantity: 5,
            unitCostPrice: 10,
            date: '2026-07-05T10:00:00Z',
            cancelled: false,
          },
          {
            productId: 1,
            type: 'entrada',
            quantity: 20,
            unitCostPrice: 10,
            date: '2026-07-06T10:00:00Z',
            cancelled: true,
          },
        ])
        .run();

      const entries = await listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].quantity).toBe(5);
    });
  });
});
