import { calculateStock, recalculateAverageCost, getDailySummary } from '../queries';
import { registerSalesSession } from '../sales';
import { products, warehouseMovements, sales } from '../schema';

// This will load db/__mocks__/client.ts
jest.mock('../client');
import { db } from '../client';

describe('db/queries', () => {
  beforeEach(() => {
    // Clean up DB before each test
    db.delete(sales).run();
    db.delete(warehouseMovements).run();
    db.delete(products).run();
  });

  describe('recalculateAverageCost', () => {
    it('calculates average cost correctly (4u * 100 + 10u * 130 -> 121.43)', async () => {
      // Setup product
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

      // Add initial stock of 4
      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'entrada',
          quantity: 4,
          unitCostPrice: 100,
          date: '2026-07-01T10:00:00Z',
        })
        .run();

      const newCost = await recalculateAverageCost(1, 10, 130);
      
      // (4 * 100 + 10 * 130) / 14 = 1700 / 14 = 121.4285714...
      expect(newCost).toBeCloseTo(121.42857, 5);
    });

    it('takes the new cost if denominator is <= 0 (stock is 0)', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Product',
          category: 'Bebidas',
          unitOfMeasure: 'u',
          averageCost: 50,
          cashPrice: 100,
          transferPrice: 100,
          lowStockThreshold: 5,
        })
        .run();

      const newCost = await recalculateAverageCost(1, 10, 130);
      expect(newCost).toBe(130);
    });
  });

  describe('calculateStock', () => {
    it('derives stock correctly: entrada 10, sale 3, loss 2, adjust -1 -> stock 4', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Prod',
          category: 'Bebidas',
          unitOfMeasure: 'u',
          averageCost: 10,
          cashPrice: 20,
          transferPrice: 20,
          lowStockThreshold: 5,
        })
        .run();

      // Entrada 10
      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'entrada',
          quantity: 10,
          unitCostPrice: 10,
          date: '2026-07-01T10:00:00Z',
        })
        .run();
        
      // Loss 2
      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'merma',
          quantity: 2,
          unitCostPrice: 10,
          date: '2026-07-02T10:00:00Z',
        })
        .run();

      // Adjust -1
      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'ajuste',
          quantity: -1,
          unitCostPrice: 10,
          date: '2026-07-03T10:00:00Z',
        })
        .run();

      // Sale 3
      db.insert(sales)
        .values({
          productId: 1,
          quantity: 3,
          appliedPrice: 20,
          paymentMethod: 'efectivo',
          costAtSale: 10,
          profit: 30,
          date: '2026-07-04T10:00:00Z',
        })
        .run();
      
      // Cancelled sale (should not deduct)
      db.insert(sales)
        .values({
          productId: 1,
          quantity: 5,
          appliedPrice: 20,
          paymentMethod: 'efectivo',
          costAtSale: 10,
          profit: 50,
          date: '2026-07-05T10:00:00Z',
          cancelled: true,
        })
        .run();

      const stock = await calculateStock(1);
      // 10 (entrada) - 2 (merma) + (-1) (ajuste) - 3 (sale) = 4
      expect(stock).toBe(4);
    });
  });

  describe('registerSalesSession', () => {
    it('inserts rows, calculates profit based on current average cost', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Prod',
          category: 'Bebidas',
          unitOfMeasure: 'u',
          averageCost: 50,
          cashPrice: 100,
          transferPrice: 110,
          lowStockThreshold: 5,
        })
        .run();

      const items = [{
        productId: 1,
        key: 'prod-1',
        name: 'Prod',
        unitOfMeasure: 'u',
        quantity: 2,
        appliedPrice: 90,
        paymentMethod: 'efectivo' as const,
        isCostSale: false,
        discountPercent: 10,
        costAtSale: 50,
        profit: 80,
      }];

      registerSalesSession(items, '2026-07-13T12:00:00Z');

      const saleRows = db.select().from(sales).all();
      expect(saleRows.length).toBe(1);
      expect(saleRows[0].quantity).toBe(2);
      expect(saleRows[0].appliedPrice).toBe(90);
      expect(saleRows[0].costAtSale).toBe(50); // From DB, not from anywhere else
      expect(saleRows[0].profit).toBe((90 - 50) * 2); // 80
    });
  });

  describe('getDailySummary', () => {
    it('groups cash and transfer correctly, ignores other dates', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Prod',
          category: 'Bebidas',
          unitOfMeasure: 'u',
          averageCost: 50,
          cashPrice: 100,
          transferPrice: 110,
          lowStockThreshold: 5,
        })
        .run();

      db.insert(sales).values([
        {
          productId: 1,
          quantity: 2,
          appliedPrice: 100,
          paymentMethod: 'efectivo',
          costAtSale: 50,
          profit: 100,
          date: '2026-07-13T10:00:00Z',
        },
        {
          productId: 1,
          quantity: 1,
          appliedPrice: 150,
          paymentMethod: 'transferencia',
          costAtSale: 50,
          profit: 100,
          date: '2026-07-13T11:00:00Z',
        },
        { // Cancelled sale, should be ignored
          productId: 1,
          quantity: 1,
          appliedPrice: 100,
          paymentMethod: 'efectivo',
          costAtSale: 50,
          profit: 50,
          date: '2026-07-13T12:00:00Z',
          cancelled: true,
        },
        { // Another date, should be ignored
          productId: 1,
          quantity: 1,
          appliedPrice: 100,
          paymentMethod: 'efectivo',
          costAtSale: 50,
          profit: 50,
          date: '2026-07-14T10:00:00Z',
        }
      ]).run();

      const summary = await getDailySummary('2026-07-13');
      expect(summary.cash).toBe(200); // 2 * 100
      expect(summary.transfer).toBe(150); // 1 * 150
      expect(summary.total).toBe(350);
      expect(summary.profit).toBe(200); // 100 + 100
    });
  });
});
