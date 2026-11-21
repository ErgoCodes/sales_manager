import { describe, expect, it } from 'vitest';

import { InvalidCursor } from '../../../../iam/domain/errors';
import { fakeTx, ID, NOW, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { encodeCursor } from '../../../../iam/infrastructure/pagination';
import { LocationPricesRepository } from '../location-prices.repository';
import { ProductsRepository } from '../products.repository';

// Raw rows: node-postgres returns bigint and numeric as strings.
const row = {
  id: ID,
  name: 'Agua',
  unitOfMeasure: 'litro',
  category: 'Bebidas',
  currency: 'CUP',
  costPrice: '800',
  cashPrice: '1000',
  transferPrice: null,
  lowStockThreshold: '2.500',
  expirationDate: '2027-01-31',
  archivedAt: null,
  createdAt: NOW_TEXT,
  updatedAt: NOW_TEXT,
};
const record = {
  id: ID,
  name: 'Agua',
  unitOfMeasure: 'litro',
  category: 'Bebidas',
  currency: 'CUP',
  costPrice: 800,
  cashPrice: 1000,
  transferPrice: null,
  lowStockThreshold: 2.5,
  expirationDate: '2027-01-31',
  archivedAt: null,
  createdAt: new Date(NOW_TEXT),
  updatedAt: new Date(NOW_TEXT),
};
const priced = { ...row, cashPriceOverride: '900', transferPriceOverride: null };
const L = '0190a000-0000-7000-8000-0000000000c1';

describe('ProductsRepository', () => {
  it('lists by (name, id): filters and the cursor are bound parameters, and amounts come back as numbers', async () => {
    const { tx, queries } = fakeTx([priced, { ...priced, id: 'next', name: 'Zumo' }], []);
    const repo = new ProductsRepository(tx, TENANT);
    const page = await repo.list({ limit: 1, q: "a'%", category: 'Bebidas', includeArchived: false, locationId: L });
    expect(page).toEqual({ items: [{ ...record, cashPriceOverride: 900, transferPriceOverride: null }], nextCursor: encodeCursor(['Agua', ID]) });
    expect(queries[0]!.sql).toMatch(/order by p\.name, p\.id limit/);
    expect(queries[0]!.sql).toMatch(/left join location_products lp/);
    expect(queries[0]!.params).toEqual(expect.arrayContaining([L, "a'%", 'Bebidas']));
    expect(queries[0]!.sql).not.toContain("a'%");

    await repo.list({ limit: 10, includeArchived: true, cursor: encodeCursor(['Agua', ID]) });
    expect(queries[1]!.params).toEqual(expect.arrayContaining(['Agua', ID]));
  });

  it('rejects a forged cursor', async () => {
    const { tx } = fakeTx();
    await expect(new ProductsRepository(tx, TENANT).list({ limit: 1, includeArchived: false, cursor: 'nope' })).rejects.toThrow(InvalidCursor);
  });

  it('finds one product with the overrides of a location, null when missing', async () => {
    const { tx, queries } = fakeTx([priced], []);
    const repo = new ProductsRepository(tx, TENANT);
    expect(await repo.findById(ID, L)).toEqual({ ...record, cashPriceOverride: 900, transferPriceOverride: null });
    expect(queries[0]!.params).toEqual([L, ID]);
    expect(await repo.findById(ID)).toBeNull();
  });

  it('creates with a fresh id, the tenant and nulls for what was not sent', async () => {
    const { tx, queries } = fakeTx([row]);
    expect(await new ProductsRepository(tx, TENANT).create({ name: 'Agua', unitOfMeasure: 'litro', currency: 'CUP', cashPrice: 1000, now: NOW })).toEqual(record);
    expect(queries[0]!.params.slice(1)).toEqual([TENANT, 'Agua', 'litro', null, 'CUP', null, 1000, null, null, null, NOW, NOW]);
  });

  it('locks FOR UPDATE / FOR SHARE', async () => {
    const { tx, queries } = fakeTx([row], [row], []);
    const repo = new ProductsRepository(tx, TENANT);
    expect(await repo.lockForUpdate(ID)).toEqual(record);
    expect(await repo.lockForShare(ID)).toEqual(record);
    expect(await repo.lockForShare(ID)).toBeNull();
    expect(queries[0]!.sql).toMatch(/for update$/);
    expect(queries[1]!.sql).toMatch(/for share$/);
  });

  it('updates only the sent columns (null clears), always touching updated_at', async () => {
    const { tx, queries } = fakeTx([row]);
    await new ProductsRepository(tx, TENANT).update(ID, { name: 'Agua 2', category: null, costPrice: 900 }, NOW);
    expect(queries[0]!.sql).toMatch(/set updated_at = \$1, name = \$2, category = \$3, cost_price = \$4 where id = \$5 returning/);
    expect(queries[0]!.params).toEqual([NOW, 'Agua 2', null, 900, ID]);
  });

  it('archives once (keeping the first date), null when missing', async () => {
    const { tx, queries } = fakeTx([{ ...row, archivedAt: NOW_TEXT }], []);
    const repo = new ProductsRepository(tx, TENANT);
    expect(await repo.archive(ID, NOW)).toEqual({ ...record, archivedAt: new Date(NOW_TEXT) });
    expect(queries[0]!.sql).toMatch(/archived_at = coalesce\(archived_at, \$1\)/);
    expect(await repo.archive(ID, NOW)).toBeNull();
  });

  it('asks the ledger whether the product has movements', async () => {
    const { tx, queries } = fakeTx([{ one: 1 }], []);
    const repo = new ProductsRepository(tx, TENANT);
    expect(await repo.hasMovements(ID)).toBe(true);
    expect(await repo.hasMovements(ID)).toBe(false);
    expect(queries[0]!.sql).toMatch(/from inventory_movements where product_id = \$1 limit 1/);
  });

  it('detects a location that still overrides a price of the product', async () => {
    const { tx, queries } = fakeTx([{ one: 1 }], []);
    const repo = new ProductsRepository(tx, TENANT);
    expect(await repo.hasPriceOverrides(ID)).toBe(true);
    expect(await repo.hasPriceOverrides(ID)).toBe(false);
    expect(queries[0]!.sql).toMatch(/from location_products\s+where product_id = \$1 and \(cash_price_override is not null or transfer_price_override is not null\)/);
  });
});

describe('LocationPricesRepository', () => {
  it('checks that a location exists', async () => {
    const { tx } = fakeTx([{ one: 1 }], []);
    const repo = new LocationPricesRepository(tx, TENANT);
    expect(await repo.locationExists(L)).toBe(true);
    expect(await repo.locationExists(L)).toBe(false);
  });

  it('upserts both overrides on the pair row, null removing one', async () => {
    const { tx, queries } = fakeTx([]);
    await new LocationPricesRepository(tx, TENANT).set({ locationId: L, productId: ID, cashPrice: 900, transferPrice: null, now: NOW });
    expect(queries[0]!.sql).toMatch(/on conflict \(tenant_id, location_id, product_id\) do update\s+set cash_price_override = excluded\.cash_price_override/);
    expect(queries[0]!.params).toEqual([TENANT, L, ID, 900, null, NOW]);
  });
});
