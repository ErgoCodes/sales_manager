import { describe, expect, it } from 'vitest';

import { fakeTx, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { encodeCursor } from '../../../../iam/infrastructure/pagination';
import { InventoryReaderRepository, MIN_STOCK_BATCH } from '../inventory-reader.repository';

const LOC = '0190a000-0000-7000-8000-0000000000c1';
const OTHER = '0190a000-0000-7000-8000-0000000000c2';
const P1 = '0190a000-0000-7000-8000-0000000000d1';
const P2 = '0190a000-0000-7000-8000-0000000000d2';
const P3 = '0190a000-0000-7000-8000-0000000000d3';

const stockRow = (productId: string, name: string, quantity: string) => ({
  productId,
  name,
  unitOfMeasure: 'kg',
  category: null,
  currency: 'CUP',
  lowStockThreshold: '2.500',
  archivedAt: null,
  quantity,
  averageCost: '10.250000',
});

describe('InventoryReaderRepository', () => {
  it('checks that a location or product exists (RLS hides other tenants)', async () => {
    const { tx, queries } = fakeTx([{ one: 1 }], [], [{ one: 1 }]);
    const repo = new InventoryReaderRepository(tx, TENANT);
    expect(await repo.locationExists(LOC)).toBe(true);
    expect(await repo.locationExists(LOC)).toBe(false);
    expect(await repo.productExists(P1)).toBe(true);
    expect(queries[0]!.sql).toMatch(/from locations where id = \$1/);
    expect(queries[2]!.sql).toMatch(/from products where id = \$1/);
  });

  it('lists the stock of a location by (name, id), converting numerics, with an opaque cursor', async () => {
    const { tx, queries } = fakeTx([stockRow(P1, 'Arroz', '3.500'), stockRow(P2, 'Frijol', '0')]);
    const repo = new InventoryReaderRepository(tx, TENANT);
    const page = await repo.listStock(LOC, { q: 'ar', cursor: encodeCursor(['A', P3]), limit: 1 });
    expect(page.items).toEqual([{ ...stockRow(P1, 'Arroz', '3.500'), lowStockThreshold: 2.5, quantity: 3.5, averageCost: 10.25 }]);
    expect(page.nextCursor).toBe(encodeCursor(['Arroz', P1]));
    expect(queries[0]!.sql).toMatch(/order by p\.name, p\.id limit \$\d+$/);
    expect(queries[0]!.sql).toMatch(/p\.archived_at is null or coalesce\(s\.quantity, 0\) <> 0/);
    expect(queries[0]!.params).toEqual(expect.arrayContaining([LOC, 'ar', 'A', P3, MIN_STOCK_BATCH]));
  });

  it('applies `keep` across batches so a filtered page is still full and its cursor points at its last row', async () => {
    const id = (i: number) => `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`;
    const name = (i: number) => `N${String(i).padStart(3, '0')}`;
    const full = Array.from({ length: MIN_STOCK_BATCH }, (_, i) => stockRow(id(i), name(i), '9'));
    const { tx, queries } = fakeTx(full, [stockRow(P3, 'O1', '1'), stockRow(OTHER, 'O2', '1')], []);
    const repo = new InventoryReaderRepository(tx, TENANT);
    const page = await repo.listStock(LOC, { limit: 1 }, (record) => record.quantity < 5);
    expect(page.items.map((r) => r.productId)).toEqual([P3]);
    expect(page.nextCursor).toBe(encodeCursor(['O1', P3]));
    // The second batch continues after the last row read, not after the last row kept.
    expect(queries[1]!.params).toEqual(expect.arrayContaining([name(MIN_STOCK_BATCH - 1), id(MIN_STOCK_BATCH - 1)]));
    expect(queries).toHaveLength(2);

    const last = fakeTx([stockRow(P1, 'A', '9')]);
    const empty = await new InventoryReaderRepository(last.tx, TENANT).listStock(LOC, { limit: 1 }, () => false);
    expect(empty).toEqual({ items: [], nextCursor: null });
    expect(last.queries).toHaveLength(1);
  });

  it('reads the stock of a product in every location, by name', async () => {
    const { tx, queries } = fakeTx([{ locationId: LOC, locationName: 'Centro', currency: 'USD', quantity: '1.250', averageCost: '0.000000' }]);
    const repo = new InventoryReaderRepository(tx, TENANT);
    expect(await repo.productStock(P1)).toEqual([{ locationId: LOC, locationName: 'Centro', currency: 'USD', quantity: 1.25, averageCost: 0 }]);
    expect(queries[0]!.sql).toMatch(/order by l\.name, l\.id$/);
    expect(queries[0]!.params).toContain(P1);
  });

  it('lists movements newest first with filters as parameters and a microsecond cursor', async () => {
    const row = {
      id: 'm1',
      documentId: 'd1',
      locationId: LOC,
      productId: P1,
      kind: 'transfer_out',
      quantityDelta: '-2.000',
      unitCost: '5.500000',
      currency: 'CUP',
      reversesMovementId: null,
      createdAt: NOW_TEXT,
      cursorAt: '2026-11-05T12:00:00.123456Z',
      counterpartLocationId: OTHER,
      counterpartLocationName: 'Playa',
    };
    const { tx, queries } = fakeTx([row, { ...row, id: 'm2' }]);
    const repo = new InventoryReaderRepository(tx, TENANT);
    const from = new Date('2026-11-01T00:00:00.000Z');
    const page = await repo.listMovements(LOC, { productId: P1, kind: 'transfer_out', from, limit: 1 });
    const { cursorAt: _cursorAt, ...expected } = row;
    expect(page.items).toEqual([{ ...expected, quantityDelta: -2, unitCost: 5.5, createdAt: new Date(NOW_TEXT) }]);
    expect(page.nextCursor).toBe(encodeCursor([row.cursorAt, 'm1']));
    expect(queries[0]!.sql).toMatch(/order by m\.created_at desc, m\.id desc limit \$\d+$/);
    expect(queries[0]!.sql).toMatch(/d\.kind = 'transfer'/);
    expect(queries[0]!.params).toEqual(expect.arrayContaining([TENANT, LOC, P1, 'transfer_out', from, null, 2]));
  });
});
