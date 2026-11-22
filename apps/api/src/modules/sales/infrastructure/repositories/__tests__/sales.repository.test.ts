import { describe, expect, it } from 'vitest';

import { fakeTx, ID, NOW, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { SalesDrizzleRepository } from '../sales.repository';

const LOC = '0190a000-0000-7000-8000-0000000000c1';
const PRODUCT = '0190a000-0000-7000-8000-0000000000d1';
const CASHIER = '0190a000-0000-7000-8000-0000000000a1';
const header = { id: ID, locationId: LOC, cashierUserId: CASHIER, occurredAt: NOW, payloadHash: 'h' };
const line = {
  productId: PRODUCT,
  currency: 'CUP' as const,
  quantity: 1.5,
  unitPrice: 133,
  discountPercent: 5,
  paymentMethod: 'transfer' as const,
  isCostSale: false,
  unitCost: 80.5,
  lineTotal: 200,
  profit: 79.25,
};

describe('SalesDrizzleRepository', () => {
  it('inserts the header, then every line with the header columns copied (sale_lines_sale_fk)', async () => {
    const { tx, queries } = fakeTx([], []);
    await new SalesDrizzleRepository(tx, TENANT).insert(header, [line]);
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql).toMatch(/^insert into sales/);
    expect(queries[0]!.params).toEqual([ID, TENANT, LOC, CASHIER, NOW, 'h']);
    expect(queries[1]!.sql).toMatch(/^insert into sale_lines/);
    const [, tenant, saleId, location, product, occurredAt, cashier, ...amounts] = queries[1]!.params;
    expect([tenant, saleId, location, product, occurredAt, cashier]).toEqual([TENANT, ID, LOC, PRODUCT, NOW, CASHIER]);
    // Numerics go as fixed-scale text: discount (5,2), unit cost and profit (20,6).
    expect(amounts).toEqual(['CUP', 1.5, 133, '5.00', 'transfer', false, '80.500000', 200, '79.250000']);
  });

  it('finds the sale with its lines by product, mapping numerics and dates; null when missing', async () => {
    const stored = { id: ID, locationId: LOC, cashierUserId: CASHIER, deviceId: null, occurredAt: NOW_TEXT, payloadHash: 'h', createdAt: NOW_TEXT };
    const lineRow = { ...line, id: 'l1', quantity: '1.500', unitPrice: '133', discountPercent: '5.00', unitCost: '80.500000', lineTotal: '200', profit: '79.250000' };
    const { tx, queries } = fakeTx([stored], [lineRow], []);
    const repo = new SalesDrizzleRepository(tx, TENANT);
    expect(await repo.find(ID)).toEqual({
      ...stored,
      occurredAt: new Date(NOW_TEXT),
      createdAt: new Date(NOW_TEXT),
      lines: [{ ...line, id: 'l1' }],
    });
    expect(queries[1]!.sql).toMatch(/order by product_id$/);
    expect(await repo.find(ID)).toBeNull();
    expect(queries).toHaveLength(3);
  });
});
