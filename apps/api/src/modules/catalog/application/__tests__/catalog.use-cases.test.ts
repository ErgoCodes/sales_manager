import { vi } from 'vitest';
import { describe, expect, it } from 'vitest';

import { actorWith, at, CASHIER_ROLE, clock, custom, LOC_1, LOC_2, MANAGER_ROLE, NOW, owner, TENANT } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import { CurrencyMismatch, InvalidCatalogValue, ProductArchived } from '../../domain/catalog-errors';
import type { CatalogTenantScope, CatalogUnitOfWork, ProductPriceRecord } from '../../domain/catalog-ports';
import { ArchiveProduct, CreateProduct, GetProduct, ListProducts, SetLocationPrice, UpdateProduct } from '../catalog.use-cases';

const PRODUCT = '0190a000-0000-7000-8000-0000000000d1';
const fn = () => vi.fn();

function fakeCatalog() {
  const scope = {
    products: { list: fn(), findById: fn(), create: fn(), lockForUpdate: fn(), lockForShare: fn(), update: fn(), archive: fn(), hasMovements: fn(), hasPriceOverrides: fn() },
    locationPrices: { locationExists: fn(), set: fn() },
    audit: { record: fn() },
  };
  const runs: string[] = [];
  const uow: CatalogUnitOfWork = {
    run: async (tenantId, work) => {
      runs.push(tenantId);
      return work(scope as unknown as CatalogTenantScope);
    },
  };
  scope.locationPrices.locationExists.mockResolvedValue(true);
  return { uow, scope, runs };
}

const record: ProductPriceRecord = {
  id: PRODUCT,
  name: 'Agua',
  unitOfMeasure: 'litro',
  category: 'Bebidas',
  currency: 'CUP',
  costPrice: 800,
  cashPrice: 1000,
  transferPrice: 1200,
  lowStockThreshold: 5,
  expirationDate: '2027-01-31',
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  cashPriceOverride: null,
  transferPriceOverride: null,
};
const cup = (amount: number) => ({ amount, currency: 'CUP' as const });
const apiProduct = {
  id: PRODUCT,
  name: 'Agua',
  unitOfMeasure: 'litro',
  category: 'Bebidas',
  currency: 'CUP',
  costPrice: cup(800),
  cashPrice: cup(1000),
  transferPrice: cup(1200),
  lowStockThreshold: 5,
  expirationDate: '2027-01-31',
  archivedAt: null,
  createdAt: '2026-11-05T12:00:00.000Z',
  updatedAt: '2026-11-05T12:00:00.000Z',
};
const manager = (...locations: string[]) => actorWith([{ role: MANAGER_ROLE, scope: at(...locations) }]);
const cashier = (...locations: string[]) => actorWith([{ role: CASHIER_ROLE, scope: at(...locations) }]);
const request = (actor = owner()) => ({ actor, ip: '203.0.113.1' });

describe('ListProducts', () => {
  const query = { includeArchived: false, limit: 50 };

  it('lists base prices with costs to a tenant-wide writer', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.list.mockResolvedValue({ items: [record], nextCursor: 'c' });
    const page = await new ListProducts(uow).execute(owner(), query);
    expect(page.nextCursor).toBe('c');
    expect(page.items[0]).toEqual({ ...apiProduct, effectiveCashPrice: cup(1000), effectiveTransferPrice: cup(1200), cashPriceOverride: null, transferPriceOverride: null });
    expect(scope.products.list).toHaveBeenCalledWith(query);
  });

  it('returns the effective price of the location and no costs to a cashier of that location', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.list.mockResolvedValue({ items: [{ ...record, cashPriceOverride: 900, transferPriceOverride: null }], nextCursor: null });
    const page = await new ListProducts(uow).execute(cashier(LOC_1), { ...query, locationId: LOC_1 });
    expect(page.items[0]).toMatchObject({ costPrice: null, cashPrice: cup(1000), effectiveCashPrice: cup(900), cashPriceOverride: cup(900), effectiveTransferPrice: cup(1200), transferPriceOverride: null });
    expect(scope.locationPrices.locationExists).toHaveBeenCalledWith(LOC_1);
  });

  it('shows costs to a manager of the asked location but not of another one', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.list.mockResolvedValue({ items: [record], nextCursor: null });
    const actor = manager(LOC_1);
    expect((await new ListProducts(uow).execute(actor, { ...query, locationId: LOC_1 })).items[0]!.costPrice).toEqual(cup(800));
    // Without locationId only a tenant-wide writer sees the base cost.
    expect((await new ListProducts(uow).execute(actor, query)).items[0]!.costPrice).toBeNull();
  });

  it('a custom role with only catalog:write at a location also reads it (D9)', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.list.mockResolvedValue({ items: [], nextCursor: null });
    const actor = actorWith([{ role: custom('r', 'catalog:write'), scope: at(LOC_1) }]);
    await expect(new ListProducts(uow).execute(actor, { ...query, locationId: LOC_1 })).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('403 before touching data: another location, or no catalog permission anywhere', async () => {
    const { uow, runs } = fakeCatalog();
    await expect(new ListProducts(uow).execute(cashier(LOC_1), { ...query, locationId: LOC_2 })).rejects.toThrow(PermissionDenied);
    await expect(new ListProducts(uow).execute(actorWith([]), query)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });

  it('404 when the location does not exist (another tenant)', async () => {
    const { uow, scope } = fakeCatalog();
    scope.locationPrices.locationExists.mockResolvedValue(false);
    await expect(new ListProducts(uow).execute(owner(), { ...query, locationId: LOC_1 })).rejects.toThrow(ResourceNotFound);
    expect(scope.products.list).not.toHaveBeenCalled();
  });
});

describe('GetProduct', () => {
  it('404 when missing, otherwise the product with the location price', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.findById.mockResolvedValueOnce(null).mockResolvedValueOnce(record);
    const useCase = new GetProduct(uow);
    await expect(useCase.execute(owner(), PRODUCT)).rejects.toThrow(ResourceNotFound);
    expect(await useCase.execute(owner(), PRODUCT, LOC_1)).toMatchObject({ id: PRODUCT, effectiveCashPrice: cup(1000) });
    expect(scope.products.findById).toHaveBeenLastCalledWith(PRODUCT, LOC_1);
  });

  it('needs catalog:view at the location (or anywhere without one) before touching data', async () => {
    const { uow, runs } = fakeCatalog();
    await expect(new GetProduct(uow).execute(cashier(LOC_1), PRODUCT, LOC_2)).rejects.toThrow(PermissionDenied);
    await expect(new GetProduct(uow).execute(actorWith([]), PRODUCT)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});

describe('CreateProduct', () => {
  const input = { name: 'Agua', unitOfMeasure: 'litro', currency: 'CUP' as const, category: 'Bebidas', costPrice: cup(800), cashPrice: cup(1000) };

  it('authorizes, creates and audits without costs in the metadata', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.create.mockResolvedValue(record);
    expect(await new CreateProduct(uow, clock).execute(request(), input)).toEqual(apiProduct);
    expect(scope.products.create).toHaveBeenCalledWith({ name: 'Agua', unitOfMeasure: 'litro', currency: 'CUP', category: 'Bebidas', costPrice: 800, cashPrice: 1000, now: NOW });
    const audit = scope.audit.record.mock.calls[0]![0];
    expect(audit).toMatchObject({ type: 'product_created', targetType: 'product', targetId: PRODUCT, actorUserId: request().actor.userId, ip: '203.0.113.1' });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/800|cost/i);
  });

  it('403 for catalog:write that is not tenant-wide (D14), before touching data', async () => {
    const { uow, runs } = fakeCatalog();
    await expect(new CreateProduct(uow, clock).execute(request(manager(LOC_1)), input)).rejects.toThrow(PermissionDenied);
    await expect(new CreateProduct(uow, clock).execute(request(cashier(LOC_1)), input)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });

  it('rejects a unit of measure or category outside the catalog lists (400)', async () => {
    const { uow, runs } = fakeCatalog();
    const useCase = new CreateProduct(uow, clock);
    await expect(useCase.execute(request(), { ...input, unitOfMeasure: 'parsec' })).rejects.toThrow(InvalidCatalogValue);
    await expect(useCase.execute(request(), { ...input, category: 'Nope' })).rejects.toThrow(InvalidCatalogValue);
    expect(runs).toEqual([]);
  });

  it('rejects an amount in another currency (422)', async () => {
    const { uow, runs } = fakeCatalog();
    await expect(new CreateProduct(uow, clock).execute(request(), { ...input, cashPrice: { amount: 1, currency: 'USD' } })).rejects.toThrow(CurrencyMismatch);
    expect(runs).toEqual([]);
  });
});

describe('UpdateProduct', () => {
  it('404 when missing; otherwise locks, updates and audits only the field names', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.lockForUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(record);
    scope.products.update.mockResolvedValue({ ...record, name: 'Agua 2' });
    const useCase = new UpdateProduct(uow, clock);
    await expect(useCase.execute(request(), PRODUCT, { name: 'Agua 2' })).rejects.toThrow(ResourceNotFound);
    expect(scope.audit.record).not.toHaveBeenCalled();
    const result = await useCase.execute(request(), PRODUCT, { name: 'Agua 2', costPrice: cup(900), category: null });
    expect(result.name).toBe('Agua 2');
    expect(scope.products.update).toHaveBeenCalledWith(PRODUCT, { name: 'Agua 2', category: null, costPrice: 900 }, NOW);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'product_updated', targetId: PRODUCT, metadata: { fields: ['name', 'category', 'costPrice'] } }));
  });

  it('changes the currency only while the product has no movements (422)', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.lockForUpdate.mockResolvedValue(record);
    scope.products.update.mockResolvedValue({ ...record, currency: 'USD' });
    const useCase = new UpdateProduct(uow, clock);
    scope.products.hasMovements.mockResolvedValueOnce(true);
    await expect(useCase.execute(request(), PRODUCT, { currency: 'USD' })).rejects.toThrow(CurrencyMismatch);
    expect(scope.products.update).not.toHaveBeenCalled();
    scope.products.hasMovements.mockResolvedValueOnce(false);
    scope.products.hasPriceOverrides.mockResolvedValueOnce(false);
    const usd = (amount: number) => ({ amount, currency: 'USD' as const });
    await useCase.execute(request(), PRODUCT, { currency: 'USD', costPrice: usd(4), cashPrice: usd(5), transferPrice: null });
    expect(scope.products.update).toHaveBeenCalledWith(PRODUCT, { currency: 'USD', costPrice: 4, cashPrice: 5, transferPrice: null }, NOW);
  });

  it('a currency change must restate every amount already set, or the old minor units would be read in the new currency (422)', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.lockForUpdate.mockResolvedValue(record);
    scope.products.hasMovements.mockResolvedValue(false);
    scope.products.hasPriceOverrides.mockResolvedValue(false);
    const useCase = new UpdateProduct(uow, clock);
    const usd = (amount: number) => ({ amount, currency: 'USD' as const });
    await expect(useCase.execute(request(), PRODUCT, { currency: 'USD' })).rejects.toMatchObject({ reason: 'stale_amounts' });
    await expect(useCase.execute(request(), PRODUCT, { currency: 'USD', costPrice: usd(4), cashPrice: usd(5) })).rejects.toMatchObject({ reason: 'stale_amounts' });
    expect(scope.products.update).not.toHaveBeenCalled();
  });

  it('a currency change is rejected while a location still has a price override in the old currency (422)', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.lockForUpdate.mockResolvedValue({ ...record, costPrice: null, cashPrice: null, transferPrice: null });
    scope.products.hasMovements.mockResolvedValue(false);
    scope.products.hasPriceOverrides.mockResolvedValue(true);
    await expect(new UpdateProduct(uow, clock).execute(request(), PRODUCT, { currency: 'USD' })).rejects.toMatchObject({ reason: 'price_overrides' });
    expect(scope.products.update).not.toHaveBeenCalled();
  });

  it('keeping the same currency does not look at the ledger, and amounts must match the resulting currency', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.lockForUpdate.mockResolvedValue(record);
    scope.products.update.mockResolvedValue(record);
    const useCase = new UpdateProduct(uow, clock);
    await useCase.execute(request(), PRODUCT, { currency: 'CUP', name: 'X' });
    expect(scope.products.hasMovements).not.toHaveBeenCalled();
    await expect(useCase.execute(request(), PRODUCT, { cashPrice: { amount: 1, currency: 'USD' } })).rejects.toThrow(CurrencyMismatch);
  });

  it('validates unit and category, and needs tenant-wide catalog:write before touching data', async () => {
    const { uow, runs } = fakeCatalog();
    const useCase = new UpdateProduct(uow, clock);
    await expect(useCase.execute(request(), PRODUCT, { unitOfMeasure: 'parsec' })).rejects.toThrow(InvalidCatalogValue);
    await expect(useCase.execute(request(manager(LOC_1)), PRODUCT, { name: 'X' })).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});

describe('ArchiveProduct', () => {
  it('404 when missing, audits only the first archive and keeps the first date', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.archive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...record, archivedAt: NOW })
      .mockResolvedValueOnce({ ...record, archivedAt: new Date('2026-01-01T00:00:00Z') });
    const useCase = new ArchiveProduct(uow, clock);
    await expect(useCase.execute(request(), PRODUCT)).rejects.toThrow(ResourceNotFound);
    expect((await useCase.execute(request(), PRODUCT)).archivedAt).toBe('2026-11-05T12:00:00.000Z');
    expect((await useCase.execute(request(), PRODUCT)).archivedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(scope.audit.record).toHaveBeenCalledTimes(1);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'product_archived', targetId: PRODUCT }));
  });

  it('needs tenant-wide catalog:write before touching data', async () => {
    const { uow, runs } = fakeCatalog();
    await expect(new ArchiveProduct(uow, clock).execute(request(manager(LOC_1)), PRODUCT)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});

describe('SetLocationPrice', () => {
  const body = { cashPrice: cup(900), transferPrice: null };

  it('locks the product, upserts the override and audits', async () => {
    const { uow, scope } = fakeCatalog();
    scope.products.lockForShare.mockResolvedValue(record);
    scope.products.findById.mockResolvedValue({ ...record, cashPriceOverride: 900 });
    const result = await new SetLocationPrice(uow, clock).execute(request(manager(LOC_1)), LOC_1, PRODUCT, body);
    expect(scope.locationPrices.set).toHaveBeenCalledWith({ locationId: LOC_1, productId: PRODUCT, cashPrice: 900, transferPrice: null, now: NOW });
    expect(result).toMatchObject({ effectiveCashPrice: cup(900), cashPriceOverride: cup(900), effectiveTransferPrice: cup(1200), costPrice: cup(800) });
    expect(scope.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'location_price_set', targetType: 'product', targetId: PRODUCT, metadata: { locationId: LOC_1, cashPrice: 900, transferPrice: null } }),
    );
  });

  it('403 in another location, and for a cashier, before touching data', async () => {
    const { uow, runs } = fakeCatalog();
    const useCase = new SetLocationPrice(uow, clock);
    await expect(useCase.execute(request(manager(LOC_1)), LOC_2, PRODUCT, body)).rejects.toThrow(PermissionDenied);
    await expect(useCase.execute(request(cashier(LOC_1)), LOC_1, PRODUCT, body)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });

  it('404 for a missing product or location, 409 ARCHIVED for an archived product, 422 for another currency', async () => {
    const { uow, scope } = fakeCatalog();
    const useCase = new SetLocationPrice(uow, clock);
    scope.products.lockForShare.mockResolvedValueOnce(null);
    await expect(useCase.execute(request(), LOC_1, PRODUCT, body)).rejects.toThrow(ResourceNotFound);
    scope.products.lockForShare.mockResolvedValueOnce({ ...record, archivedAt: NOW });
    await expect(useCase.execute(request(), LOC_1, PRODUCT, body)).rejects.toThrow(ProductArchived);
    scope.products.lockForShare.mockResolvedValueOnce(record);
    await expect(useCase.execute(request(), LOC_1, PRODUCT, { cashPrice: { amount: 1, currency: 'MLC' }, transferPrice: null })).rejects.toThrow(CurrencyMismatch);
    scope.products.lockForShare.mockResolvedValueOnce(record);
    scope.locationPrices.locationExists.mockResolvedValueOnce(false);
    await expect(useCase.execute(request(), LOC_1, PRODUCT, body)).rejects.toThrow(ResourceNotFound);
    expect(scope.locationPrices.set).not.toHaveBeenCalled();
    expect(scope.audit.record).not.toHaveBeenCalled();
  });
});

void TENANT;
