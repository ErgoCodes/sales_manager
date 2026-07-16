import { registerEntry } from '../movements';
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
});
