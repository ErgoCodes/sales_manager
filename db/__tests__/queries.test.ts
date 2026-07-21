import { eq } from 'drizzle-orm';
import { calculateStock, recalculateAverageCost, getDailySummary } from '../queries';
import { createProduct } from '../products';
import { registerSalesSession, runAverageCostBackfill } from '../sales';
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

  describe('createProduct', () => {
    it('seeds averageCost with costPrice when creating a product', async () => {
      const id = await createProduct({
        name: 'Chupa chupa',
        category: 'Dulces',
        unitOfMeasure: 'u',
        costPrice: 45,
        cashPrice: 60,
        transferPrice: 60,
      });

      const [p] = db.select().from(products).where(eq(products.id, id)).all();
      expect(p.costPrice).toBe(45);
      expect(p.averageCost).toBe(45);
    });
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
          costPrice: 100,
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

    it('uses costPrice when averageCost is 0 and does not dilute to 0', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Chupa chupa',
          category: 'Dulces',
          unitOfMeasure: 'u',
          averageCost: 0,
          costPrice: 45,
          cashPrice: 60,
          transferPrice: 60,
        })
        .run();

      // Stock of 10 was added previously without updating averageCost
      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'ajuste',
          quantity: 10,
          unitCostPrice: 45,
          date: '2026-07-01T10:00:00Z',
        })
        .run();

      // New entry of 10 units at cost 45
      const newCost = await recalculateAverageCost(1, 10, 45);
      // (10 * 45 + 10 * 45) / 20 = 45 (not 22.50)
      expect(newCost).toBe(45);
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

      // Owner withdrawal 1
      db.insert(warehouseMovements)
        .values({
          productId: 1,
          type: 'retiro_owner',
          quantity: 1,
          unitCostPrice: 10,
          date: '2026-07-02T11:00:00Z',
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
      // 10 (entrada) - 2 (merma) - 1 (retiro_owner) + (-1) (ajuste) - 3 (sale) = 3
      expect(stock).toBe(3);
    });
  });

  describe('registerSalesSession', () => {
    it('calculates profit = 15 when selling a 45 cost item for 60 even if averageCost was 0', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Chupa chupa',
          category: 'Dulces',
          unitOfMeasure: 'u',
          costPrice: 45,
          averageCost: 0,
          cashPrice: 60,
          transferPrice: 60,
        })
        .run();

      const items = [{
        productId: 1,
        key: 'prod-1',
        name: 'Chupa chupa',
        unitOfMeasure: 'u',
        quantity: 1,
        appliedPrice: 60,
        paymentMethod: 'efectivo' as const,
        isCostSale: false,
        discountPercent: 0,
        costAtSale: 45,
        profit: 15,
      }];

      registerSalesSession(items, '2026-07-19T12:00:00Z');

      const saleRows = db.select().from(sales).all();
      expect(saleRows.length).toBe(1);
      expect(saleRows[0].costAtSale).toBe(45);
      expect(saleRows[0].profit).toBe(15);
    });
  });

  describe('runAverageCostBackfill', () => {
    it('backfills products with averageCost 0 to costPrice and recalculates legacy sales', async () => {
      db.insert(products)
        .values({
          id: 1,
          name: 'Chupa chupa',
          category: 'Dulces',
          unitOfMeasure: 'u',
          costPrice: 45,
          averageCost: 0,
          cashPrice: 60,
          transferPrice: 60,
        })
        .run();

      // Legacy inflated sale recorded with costAtSale = 22.50 and profit = 37.50
      const [{ saleId }] = db
        .insert(sales)
        .values({
          productId: 1,
          quantity: 1,
          appliedPrice: 60,
          paymentMethod: 'efectivo',
          costAtSale: 22.50,
          profit: 37.50,
          date: '2026-07-19T10:00:00Z',
        })
        .returning({ saleId: sales.id })
        .all();

      const result = await runAverageCostBackfill();
      expect(result.updatedProducts).toBe(1);
      expect(result.updatedSales).toBe(1);

      const [p] = db.select().from(products).where(eq(products.id, 1)).all();
      expect(p.averageCost).toBe(45);

      const [s] = db.select().from(sales).where(eq(sales.id, saleId)).all();
      expect(s).toBeDefined();
      expect(s.costAtSale).toBe(45);
      expect(s.profit).toBe(15);
    });
  });
});
