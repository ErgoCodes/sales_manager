import { describe, expect, it } from 'vitest';

import { fakeTx, ID, NOW, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { pairKey } from '../../../domain/inventory-ports';
import { InventoryLedgerRepository } from '../inventory-ledger.repository';

const LOC = '0190a000-0000-7000-8000-0000000000c1';
const PRODUCT = '0190a000-0000-7000-8000-0000000000d1';
const PAIR = { locationId: LOC, productId: PRODUCT };

describe('InventoryLedgerRepository', () => {
  it('inserts the header idempotently: true when inserted, false when the id already existed', async () => {
    const { tx, queries } = fakeTx([{ id: ID }], []);
    const repo = new InventoryLedgerRepository(tx, TENANT);
    const header = { id: ID, kind: 'exit' as const, locationId: LOC, reason: 'shrinkage' as const, occurredAt: NOW, notes: null, payloadHash: 'h', createdBy: 'u' };
    expect(await repo.insertDocumentHeader(header)).toBe(true);
    expect(await repo.insertDocumentHeader(header)).toBe(false);
    // No conflict target: every unique index (PK and (id, tenant_id)) must arbitrate a race.
    expect(queries[0]!.sql).toMatch(/on conflict do nothing/);
    expect(queries[0]!.params).toEqual([ID, TENANT, 'exit', LOC, 'shrinkage', NOW, null, 'h', 'u']);
  });

  it('reads a document with its movements, converting numerics and dates', async () => {
    const document = { id: ID, kind: 'entry', locationId: LOC, locationName: 'Centro', targetLocationId: null, targetLocationName: null, reason: null, reversesDocumentId: null, occurredAt: NOW_TEXT, notes: 'n', payloadHash: 'h', createdBy: 'u', createdAt: NOW_TEXT };
    const movement = { id: 'm1', documentId: ID, locationId: LOC, productId: PRODUCT, kind: 'entry', quantityDelta: '2.500', unitCost: '150.500000', currency: 'CUP', reversesMovementId: null, createdAt: NOW_TEXT };
    const { tx, queries } = fakeTx([document], [movement], []);
    const repo = new InventoryLedgerRepository(tx, TENANT);
    expect(await repo.findDocument(ID)).toEqual({
      ...document,
      occurredAt: new Date(NOW_TEXT),
      createdAt: new Date(NOW_TEXT),
      movements: [{ ...movement, quantityDelta: 2.5, unitCost: 150.5, createdAt: new Date(NOW_TEXT) }],
    });
    expect(queries[1]!.sql).toMatch(/order by m\.created_at, m\.id/);
    expect(await repo.findDocument(ID)).toBeNull();
    expect(queries).toHaveLength(3);
  });

  it('share-locks locations and products in ascending id order', async () => {
    const { tx, queries } = fakeTx([{ id: LOC, archivedAt: NOW_TEXT }], [{ id: PRODUCT, currency: 'USD', archivedAt: null }]);
    const repo = new InventoryLedgerRepository(tx, TENANT);
    expect(await repo.lockLocations([LOC])).toEqual([{ id: LOC, archivedAt: new Date(NOW_TEXT) }]);
    expect(await repo.lockProducts([PRODUCT])).toEqual([{ id: PRODUCT, currency: 'USD', archivedAt: null }]);
    expect(queries[0]!.sql).toMatch(/order by id for share$/);
    expect(queries[1]!.sql).toMatch(/order by id for share$/);
    expect(queries[1]!.params).toEqual([[PRODUCT]]);
  });

  it('creates the missing pairs in the given order, then locks them FOR UPDATE ordered by (location, product)', async () => {
    const { tx, queries } = fakeTx([], [{ ...PAIR, averageCost: '12.500000' }]);
    const repo = new InventoryLedgerRepository(tx, TENANT);
    await repo.ensureLocationProducts([PAIR]);
    expect(queries[0]!.sql).toMatch(/with ordinality/);
    expect(queries[0]!.sql).toMatch(/order by t\.n\s+on conflict do nothing/);
    expect(queries[0]!.params).toEqual([TENANT, [LOC], [PRODUCT]]);
    expect(await repo.lockLocationProducts([PAIR])).toEqual([{ ...PAIR, averageCost: 12.5 }]);
    expect(queries[1]!.sql).toMatch(/order by lp\.location_id, lp\.product_id\s+for update of lp$/);
  });

  it('sums the stock per pair (absent pairs have no row)', async () => {
    const { tx, queries } = fakeTx([{ ...PAIR, stock: '7.250' }]);
    const stock = await new InventoryLedgerRepository(tx, TENANT).sumStock([PAIR]);
    expect(stock.get(pairKey(PAIR))).toBe(7.25);
    expect(queries[0]!.sql).toMatch(/sum\(m\.quantity_delta\)/);
    expect(queries[0]!.params).toEqual([TENANT, [LOC], [PRODUCT]]);
  });

  it('inserts every movement in one statement with a fresh id and clock_timestamp(), and skips an empty list', async () => {
    const { tx, queries } = fakeTx();
    const repo = new InventoryLedgerRepository(tx, TENANT);
    await repo.insertMovements(ID, []);
    expect(queries).toHaveLength(0);
    await repo.insertMovements(ID, [
      { ...PAIR, kind: 'entry', quantityDelta: 2.5, unitCost: 100 },
      { locationId: LOC, productId: ID, kind: 'adjustment', quantityDelta: -1, unitCost: 0 },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql.match(/clock_timestamp\(\)/g)).toHaveLength(2);
    expect(queries[0]!.params.filter((p) => p === TENANT)).toHaveLength(2);
    expect(queries[0]!.params).toContain(-1);
  });

  it('projects the average cost with six decimals', async () => {
    const { tx, queries } = fakeTx();
    await new InventoryLedgerRepository(tx, TENANT).setAverageCost(PAIR, 150.00000000000003);
    expect(queries[0]!.params).toEqual(['150.000000', TENANT, LOC, PRODUCT]);
  });
});
