import { describe, expect, it } from 'vitest';

import { actorWith, at, CASHIER_ROLE, custom, LOC_1, LOC_2, MANAGER_ROLE, owner, TENANT_SCOPE } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import type { MovementRecord, StockRecord, StoredDocument, StoredMovement } from '../../domain/inventory-ports';
import { GENERAL_STOCK_THRESHOLD, GetInventoryDocument, GetLocationStock, GetProductStock, ListLocationMovements } from '../inventory-reads.use-cases';
import { CREATED_AT, DOC_ID, fakeInventory, fakeReader, fakeState, PRODUCT_A } from './inventory-fakes';

const manager = () => actorWith([{ role: MANAGER_ROLE, scope: at(LOC_1) }]);
const cashier = () => actorWith([{ role: CASHIER_ROLE, scope: at(LOC_1) }]);
const nobody = () => actorWith([{ role: custom('none'), scope: TENANT_SCOPE }]);
/** A custom role (is_system = false) that only writes inventory at LOC_1 (D9 implication + D10). */
const receiver = () => actorWith([{ role: custom('receiver', 'inventory:write'), scope: at(LOC_1) }]);

const stockRecord = (overrides: Partial<StockRecord> = {}): StockRecord => ({
  productId: PRODUCT_A,
  name: 'Arroz',
  unitOfMeasure: 'kg',
  category: null,
  currency: 'CUP',
  lowStockThreshold: null,
  archivedAt: null,
  quantity: 3,
  averageCost: 120.5,
  ...overrides,
});

const movement = (overrides: Partial<StoredMovement> = {}): StoredMovement => ({
  id: 'm1',
  documentId: DOC_ID,
  locationId: LOC_1,
  productId: PRODUCT_A,
  kind: 'entry',
  quantityDelta: 2,
  unitCost: 150,
  currency: 'CUP',
  reversesMovementId: null,
  createdAt: CREATED_AT,
  ...overrides,
});

const movementRecord = (overrides: Partial<MovementRecord> = {}): MovementRecord => ({
  ...movement(),
  counterpartLocationId: null,
  counterpartLocationName: null,
  ...overrides,
});

/** A transfer LOC_1 -> LOC_2 of 2 units, as T6 will write it. */
const transfer = (): StoredDocument => ({
  id: DOC_ID,
  kind: 'transfer',
  locationId: LOC_1,
  locationName: 'Centro',
  targetLocationId: LOC_2,
  targetLocationName: 'Playa',
  reason: null,
  reversesDocumentId: null,
  occurredAt: CREATED_AT,
  notes: null,
  payloadHash: 'h',
  createdBy: 'u',
  createdAt: CREATED_AT,
  movements: [
    movement({ id: 'out', kind: 'transfer_out', quantityDelta: -2, locationId: LOC_1 }),
    movement({ id: 'in', kind: 'transfer_in', quantityDelta: 2, locationId: LOC_2 }),
  ],
});

describe('GetLocationStock (GET /locations/:locationId/stock)', () => {
  it('authorizes inventory:view at the location before touching data (403 elsewhere)', async () => {
    const f = fakeInventory();
    await expect(new GetLocationStock(f.uow).execute(manager(), LOC_2, { limit: 50 })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(new GetLocationStock(f.uow).execute(nobody(), LOC_1, { limit: 50 })).rejects.toBeInstanceOf(PermissionDenied);
    expect(f.runs).toEqual([]);
  });

  it('is a 404 for a location the tenant cannot see (another tenant, or missing)', async () => {
    const reader = fakeReader();
    reader.locationExists.mockResolvedValue(false);
    const f = fakeInventory(fakeState(), reader);
    await expect(new GetLocationStock(f.uow).execute(owner(), LOC_1, { limit: 50 })).rejects.toBeInstanceOf(ResourceNotFound);
    expect(reader.listStock).not.toHaveBeenCalled();
  });

  it('maps the stock with the effective threshold of the domain and the average cost for writers', async () => {
    const reader = fakeReader();
    reader.listStock.mockResolvedValue({
      items: [
        stockRecord(),
        stockRecord({ productId: 'p2', name: 'Refresco', category: 'Bebidas', quantity: 30 }),
        stockRecord({ productId: 'p3', name: 'Sal', lowStockThreshold: 10, quantity: 10, archivedAt: CREATED_AT }),
      ],
      nextCursor: 'next',
    });
    const f = fakeInventory(fakeState(), reader);
    const page = await new GetLocationStock(f.uow).execute(manager(), LOC_1, { q: 'a', cursor: 'c', limit: 3 });
    expect(reader.listStock).toHaveBeenCalledWith(LOC_1, { q: 'a', cursor: 'c', limit: 3 }, undefined);
    expect(page.nextCursor).toBe('next');
    expect(page.items).toEqual([
      {
        productId: PRODUCT_A,
        name: 'Arroz',
        unitOfMeasure: 'kg',
        category: null,
        quantity: 3,
        lowStockThreshold: GENERAL_STOCK_THRESHOLD,
        isLow: true,
        averageCost: { amount: 120.5, currency: 'CUP' },
        archivedAt: null,
      },
      expect.objectContaining({ productId: 'p2', lowStockThreshold: 24, isLow: false }),
      expect.objectContaining({ productId: 'p3', lowStockThreshold: 10, isLow: false, archivedAt: CREATED_AT.toISOString() }),
    ]);
  });

  it('hides the average cost from a reader without catalog:write or inventory:write there (cashier)', async () => {
    const reader = fakeReader();
    reader.listStock.mockResolvedValue({ items: [stockRecord()], nextCursor: null });
    const f = fakeInventory(fakeState(), reader);
    const page = await new GetLocationStock(f.uow).execute(cashier(), LOC_1, { limit: 50 });
    expect(page.items[0]!.averageCost).toBeNull();
  });

  it('a custom role with only inventory:write reads its location and sees costs (D9 + D10)', async () => {
    const reader = fakeReader();
    reader.listStock.mockResolvedValue({ items: [stockRecord()], nextCursor: null });
    const f = fakeInventory(fakeState(), reader);
    const page = await new GetLocationStock(f.uow).execute(receiver(), LOC_1, { limit: 50 });
    expect(page.items[0]!.averageCost).toEqual({ amount: 120.5, currency: 'CUP' });
    await expect(new GetLocationStock(f.uow).execute(receiver(), LOC_2, { limit: 50 })).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('?lowStockOnly passes a filter that keeps only the products under their effective threshold', async () => {
    const reader = fakeReader();
    const f = fakeInventory(fakeState(), reader);
    await new GetLocationStock(f.uow).execute(owner(), LOC_1, { lowStockOnly: true, limit: 10 });
    const keep = reader.listStock.mock.calls[0]![2]!;
    expect(keep(stockRecord({ quantity: GENERAL_STOCK_THRESHOLD - 0.001 }))).toBe(true);
    expect(keep(stockRecord({ quantity: GENERAL_STOCK_THRESHOLD }))).toBe(false);
    expect(keep(stockRecord({ category: 'Bebidas', quantity: 23 }))).toBe(true);
    expect(keep(stockRecord({ lowStockThreshold: 0, quantity: 0 }))).toBe(false);
    expect(reader.listStock.mock.calls[0]![1]).toEqual({ limit: 10 });
  });
});

describe('GetProductStock (GET /products/:id/stock)', () => {
  const locations = [
    { locationId: LOC_1, locationName: 'Centro', currency: 'CUP' as const, quantity: 4, averageCost: 100 },
    { locationId: LOC_2, locationName: 'Playa', currency: 'CUP' as const, quantity: 7, averageCost: 90 },
  ];

  it('returns only the locations where the actor has inventory:view, costs per location', async () => {
    const reader = fakeReader();
    reader.productStock.mockResolvedValue(locations);
    const f = fakeInventory(fakeState(), reader);
    expect(await new GetProductStock(f.uow).execute(manager(), PRODUCT_A)).toEqual({
      productId: PRODUCT_A,
      locations: [{ locationId: LOC_1, locationName: 'Centro', quantity: 4, averageCost: { amount: 100, currency: 'CUP' } }],
    });
    expect((await new GetProductStock(f.uow).execute(cashier(), PRODUCT_A)).locations).toEqual([
      { locationId: LOC_1, locationName: 'Centro', quantity: 4, averageCost: null },
    ]);
    expect((await new GetProductStock(f.uow).execute(owner(), PRODUCT_A)).locations.map((l) => l.locationId)).toEqual([LOC_1, LOC_2]);
    expect((await new GetProductStock(f.uow).execute(receiver(), PRODUCT_A)).locations).toEqual([
      { locationId: LOC_1, locationName: 'Centro', quantity: 4, averageCost: { amount: 100, currency: 'CUP' } },
    ]);
  });

  it('is a 403 without inventory:view anywhere (before data) and a 404 for an unknown product', async () => {
    const reader = fakeReader();
    const f = fakeInventory(fakeState(), reader);
    await expect(new GetProductStock(f.uow).execute(nobody(), PRODUCT_A)).rejects.toBeInstanceOf(PermissionDenied);
    expect(f.runs).toEqual([]);
    reader.productExists.mockResolvedValue(false);
    await expect(new GetProductStock(f.uow).execute(owner(), PRODUCT_A)).rejects.toBeInstanceOf(ResourceNotFound);
    expect(reader.productStock).not.toHaveBeenCalled();
  });
});

describe('ListLocationMovements (GET /locations/:locationId/inventory-movements)', () => {
  it('authorizes inventory:view at the location and 404s an invisible location', async () => {
    const reader = fakeReader();
    const f = fakeInventory(fakeState(), reader);
    await expect(new ListLocationMovements(f.uow).execute(manager(), LOC_2, { limit: 50 })).rejects.toBeInstanceOf(PermissionDenied);
    expect(f.runs).toEqual([]);
    reader.locationExists.mockResolvedValue(false);
    await expect(new ListLocationMovements(f.uow).execute(owner(), LOC_1, { limit: 50 })).rejects.toBeInstanceOf(ResourceNotFound);
    expect(reader.listMovements).not.toHaveBeenCalled();
  });

  it('passes the filters (dates as Date) and the page to the reader', async () => {
    const reader = fakeReader();
    const f = fakeInventory(fakeState(), reader);
    await new ListLocationMovements(f.uow).execute(owner(), LOC_1, {
      productId: PRODUCT_A,
      kind: 'entry',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
      cursor: 'c',
      limit: 5,
    });
    expect(reader.listMovements).toHaveBeenCalledWith(LOC_1, {
      productId: PRODUCT_A,
      kind: 'entry',
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-02T00:00:00.000Z'),
      cursor: 'c',
      limit: 5,
    });
    await new ListLocationMovements(f.uow).execute(owner(), LOC_1, { limit: 5 });
    expect(reader.listMovements).toHaveBeenLastCalledWith(LOC_1, { limit: 5 });
  });

  it('masks the other location of a transfer without inventory:view there, and hides costs without write', async () => {
    const reader = fakeReader();
    const out = movementRecord({ kind: 'transfer_out', quantityDelta: -2, counterpartLocationId: LOC_2, counterpartLocationName: 'Playa' });
    reader.listMovements.mockResolvedValue({ items: [out, movementRecord({ id: 'm2' })], nextCursor: 'n' });
    const f = fakeInventory(fakeState(), reader);

    const asManager = await new ListLocationMovements(f.uow).execute(manager(), LOC_1, { limit: 50 });
    expect(asManager.nextCursor).toBe('n');
    expect(asManager.items[0]).toEqual({
      id: 'm1',
      documentId: DOC_ID,
      locationId: LOC_1,
      counterpartLocationId: null,
      counterpartLocationName: null,
      productId: PRODUCT_A,
      kind: 'transfer_out',
      quantityDelta: -2,
      unitCost: { amount: 150, currency: 'CUP' },
      reversesMovementId: null,
      createdAt: CREATED_AT.toISOString(),
    });
    expect(asManager.items[1]).toMatchObject({ id: 'm2', counterpartLocationId: null, unitCost: { amount: 150, currency: 'CUP' } });

    const asOwner = await new ListLocationMovements(f.uow).execute(owner(), LOC_1, { limit: 50 });
    expect(asOwner.items[0]).toMatchObject({ counterpartLocationId: LOC_2, counterpartLocationName: 'Playa' });

    const asCashier = await new ListLocationMovements(f.uow).execute(cashier(), LOC_1, { limit: 50 });
    expect(asCashier.items.map((m) => m.unitCost)).toEqual([null, null]);
    expect(asCashier.items[0]).toMatchObject({ counterpartLocationId: null, counterpartLocationName: null });
  });
});

describe('GetInventoryDocument (GET /inventory/documents/:id)', () => {
  it('is a 403 without inventory:view anywhere, before touching data', async () => {
    const f = fakeInventory();
    await expect(new GetInventoryDocument(f.uow).execute(nobody(), DOC_ID)).rejects.toBeInstanceOf(PermissionDenied);
    expect(f.runs).toEqual([]);
  });

  it('is a 404 for a document the tenant cannot see', async () => {
    const f = fakeInventory(fakeState({ inserted: false }));
    await expect(new GetInventoryDocument(f.uow).execute(owner(), DOC_ID)).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('is a 403 when the actor views none of the document locations', async () => {
    const f = fakeInventory(fakeState({ existing: { ...transfer(), kind: 'entry', targetLocationId: null, targetLocationName: null, locationId: LOC_2, locationName: 'Playa', movements: [movement({ locationId: LOC_2 })] } }));
    await expect(new GetInventoryDocument(f.uow).execute(manager(), DOC_ID)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('shows the whole transfer to who views both locations', async () => {
    const f = fakeInventory(fakeState({ existing: transfer() }));
    const doc = await new GetInventoryDocument(f.uow).execute(owner(), DOC_ID);
    expect(doc).toMatchObject({ locationId: LOC_1, locationName: 'Centro', targetLocationId: LOC_2, targetLocationName: 'Playa' });
    expect(doc.movements.map((m) => [m.id, m.counterpartLocationId, m.counterpartLocationName])).toEqual([
      ['out', LOC_2, 'Playa'],
      ['in', LOC_1, 'Centro'],
    ]);
  });

  it('masks the other location of a transfer: id and name null, only the own movement listed', async () => {
    const f = fakeInventory(fakeState({ existing: transfer() }));
    const fromOrigin = await new GetInventoryDocument(f.uow).execute(manager(), DOC_ID);
    expect(fromOrigin).toMatchObject({ locationId: LOC_1, locationName: 'Centro', targetLocationId: null, targetLocationName: null });
    expect(fromOrigin.movements).toEqual([expect.objectContaining({ id: 'out', counterpartLocationId: null, counterpartLocationName: null, unitCost: { amount: 150, currency: 'CUP' } })]);
    expect(JSON.stringify(fromOrigin)).not.toContain('Playa');
    expect(JSON.stringify(fromOrigin)).not.toContain(LOC_2);

    const atDestination = actorWith([{ role: CASHIER_ROLE, scope: at(LOC_2) }]);
    const fromDestination = await new GetInventoryDocument(f.uow).execute(atDestination, DOC_ID);
    expect(fromDestination).toMatchObject({ locationId: null, locationName: null, targetLocationId: LOC_2, targetLocationName: 'Playa' });
    expect(fromDestination.movements).toEqual([expect.objectContaining({ id: 'in', counterpartLocationId: null, unitCost: null })]);
    expect(JSON.stringify(fromDestination)).not.toContain('Centro');
  });

  it('a reversal shows the movements of every viewable location it touched', async () => {
    const reversal: StoredDocument = {
      ...transfer(),
      kind: 'reversal',
      targetLocationId: null,
      targetLocationName: null,
      reversesDocumentId: 'orig',
      movements: [movement({ id: 'r1', kind: 'reversal', locationId: LOC_1 }), movement({ id: 'r2', kind: 'reversal', locationId: LOC_2 })],
    };
    const f = fakeInventory(fakeState({ existing: reversal }));
    const atDestination = actorWith([{ role: MANAGER_ROLE, scope: at(LOC_2) }]);
    const doc = await new GetInventoryDocument(f.uow).execute(atDestination, DOC_ID);
    expect(doc).toMatchObject({ locationId: null, locationName: null });
    expect(doc.movements.map((m) => [m.id, m.counterpartLocationId])).toEqual([['r2', null]]);
  });
});
