import { listExpenses, sumExpenses } from '../expenses';
import { listMovements, sumLossOutflowsValue } from '../movements';
import { expenses, products, warehouseMovements } from '../schema';

// Load db/__mocks__/client.ts
jest.mock('../client');
import { db } from '../client';

describe('Expenses and Movements filtering for month total vs list', () => {
  beforeEach(() => {
    db.delete(expenses).run();
    db.delete(warehouseMovements).run();
    db.delete(products).run();

    db.insert(products)
      .values({
        id: 1,
        name: 'Producto Test',
        category: 'Bebidas',
        unitOfMeasure: 'u',
        averageCost: 100,
        cashPrice: 150,
        transferPrice: 150,
        lowStockThreshold: 5,
      })
      .run();
  });

  it('filters movements by date range and excludes ajuste from loss list and loss sum', async () => {
    // Current month movement (merma) - 2026-07-15
    db.insert(warehouseMovements)
      .values({
        id: 1,
        productId: 1,
        type: 'merma',
        quantity: 2,
        unitCostPrice: 100,
        date: '2026-07-15T10:00:00Z',
      })
      .run();

    // Current month movement (retiro owner) - 2026-07-18
    db.insert(warehouseMovements)
      .values({
        id: 2,
        productId: 1,
        type: 'retiro_owner',
        quantity: 1,
        unitCostPrice: 100,
        date: '2026-07-18T10:00:00Z',
      })
      .run();

    // Current month adjustment (ajuste) - 2026-07-16 (should be excluded from loss list & loss sum)
    db.insert(warehouseMovements)
      .values({
        id: 3,
        productId: 1,
        type: 'ajuste',
        quantity: -5,
        unitCostPrice: 100,
        date: '2026-07-16T10:00:00Z',
      })
      .run();

    // Previous month movement (retiro owner) - 2026-06-20 (should be excluded by date filter)
    db.insert(warehouseMovements)
      .values({
        id: 4,
        productId: 1,
        type: 'retiro_owner',
        quantity: 3,
        unitCostPrice: 100,
        date: '2026-06-20T10:00:00Z',
      })
      .run();

    const monthStart = '2026-07-01';
    const monthEnd = '2026-07-31';

    const movementsList = await listMovements({
      types: ['merma', 'retiro_owner'],
      dateFrom: monthStart,
      dateTo: monthEnd,
    });

    // Only July merma and retiro_owner should be listed (2 items)
    expect(movementsList).toHaveLength(2);
    expect(movementsList.map((m) => m.id)).toEqual([2, 1]); // descending date

    const lossSum = await sumLossOutflowsValue(monthStart, monthEnd);
    // 2 * 100 (merma) + 1 * 100 (retiro_owner) = 300
    expect(lossSum).toBe(300);
  });

  it('filters expenses by date range', async () => {
    db.insert(expenses)
      .values([
        {
          id: 1,
          type: 'salario',
          concept: 'Pago empleado',
          amount: 500,
          date: '2026-07-05T10:00:00Z',
        },
        {
          id: 2,
          type: 'multa',
          concept: 'Multa tránsito',
          amount: 200,
          date: '2026-06-15T10:00:00Z', // previous month
        },
      ])
      .run();

    const monthStart = '2026-07-01';
    const monthEnd = '2026-07-31';

    const expList = await listExpenses({
      dateFrom: monthStart,
      dateTo: monthEnd,
    });

    expect(expList).toHaveLength(1);
    expect(expList[0].id).toBe(1);

    const expSum = await sumExpenses(monthStart, monthEnd);
    expect(expSum).toBe(500);
  });
});
