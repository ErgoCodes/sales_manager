import { describe, expect, it } from 'vitest';

import {
  AUDIT_EVENT_TYPES,
  AverageCost,
  CreateAdjustmentRequest,
  CreateEntryRequest,
  CreateExitRequest,
  CreateProductRequest,
  CreateTransferRequest,
  ListProductsQuery,
  StockQuery,
  UpdateProductRequest,
  CreateReversalRequest,
  INVENTORY_DOCUMENT_KINDS,
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_ERROR_CODES,
  PERMISSIONS,
  Quantity,
  SetLocationPriceRequest,
  SignedQuantity,
  uuidv7,
} from '../index';

const id = () => uuidv7();
const money = { amount: 100, currency: 'CUP' as const };
const line = (extra: object = {}) => ({ productId: id(), quantity: 1, unitCost: money, ...extra });

describe('Quantity', () => {
  it('accepts up to 3 decimals and rejects 4', () => {
    expect(Quantity.safeParse(0.001).success).toBe(true);
    expect(Quantity.safeParse(1.005).success).toBe(true);
    expect(Quantity.safeParse(0.1 + 0.2).success).toBe(true);
    expect(Quantity.safeParse(0.0001).success).toBe(false);
    expect(Quantity.safeParse(1.2345).success).toBe(false);
  });
  it('rejects zero, negatives, NaN, Infinity and values beyond numeric(14,3)', () => {
    for (const bad of [0, -1, Number.NaN, Infinity, 1e11]) expect(Quantity.safeParse(bad).success).toBe(false);
    expect(Quantity.safeParse(99_999_999_999.999).success).toBe(true);
  });
});

describe('SignedQuantity', () => {
  it('accepts negative and positive with up to 3 decimals, rejects zero and 4 decimals', () => {
    expect(SignedQuantity.safeParse(-2.5).success).toBe(true);
    expect(SignedQuantity.safeParse(2.5).success).toBe(true);
    expect(SignedQuantity.safeParse(0).success).toBe(false);
    expect(SignedQuantity.safeParse(-0.0001).success).toBe(false);
    expect(SignedQuantity.safeParse(-1e11).success).toBe(false);
  });
});

describe('AverageCost', () => {
  it('allows a sub-cent fraction, never negative', () => {
    expect(AverageCost.safeParse({ amount: 12.345678, currency: 'USD' }).success).toBe(true);
    expect(AverageCost.safeParse({ amount: -1, currency: 'USD' }).success).toBe(false);
    expect(AverageCost.safeParse({ amount: 1, currency: 'EUR' }).success).toBe(false);
  });
});

describe('inventory commands', () => {
  const base = () => ({ id: id(), locationId: id() });

  it('entry: 1..100 lines, no repeated products, notes <= 500', () => {
    const ok = { ...base(), lines: [line()] };
    expect(CreateEntryRequest.safeParse(ok).success).toBe(true);
    expect(CreateEntryRequest.safeParse({ ...ok, lines: [] }).success).toBe(false);
    const many = (n: number) => Array.from({ length: n }, () => line());
    expect(CreateEntryRequest.safeParse({ ...ok, lines: many(100) }).success).toBe(true);
    expect(CreateEntryRequest.safeParse({ ...ok, lines: many(101) }).success).toBe(false);
    const p = id();
    expect(CreateEntryRequest.safeParse({ ...ok, lines: [line({ productId: p }), line({ productId: p })] }).success).toBe(false);
    expect(CreateEntryRequest.safeParse({ ...ok, notes: 'x'.repeat(500) }).success).toBe(true);
    expect(CreateEntryRequest.safeParse({ ...ok, notes: 'x'.repeat(501) }).success).toBe(false);
    expect(CreateEntryRequest.safeParse({ ...ok, lines: [line({ quantity: 0 })] }).success).toBe(false);
    expect(CreateEntryRequest.safeParse({ ...ok, lines: [line({ quantity: 1.0001 })] }).success).toBe(false);
  });

  it('entry: rejects an unknown key (strict) and a non-v7 id', () => {
    const ok = { ...base(), lines: [line()] };
    expect(CreateEntryRequest.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(CreateEntryRequest.safeParse({ ...ok, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('exit: reason is shrinkage or owner_withdrawal', () => {
    const ok = { ...base(), reason: 'shrinkage', lines: [{ productId: id(), quantity: 2 }] };
    expect(CreateExitRequest.safeParse(ok).success).toBe(true);
    expect(CreateExitRequest.safeParse({ ...ok, reason: 'owner_withdrawal' }).success).toBe(true);
    expect(CreateExitRequest.safeParse({ ...ok, reason: 'sale' }).success).toBe(false);
  });

  it('adjustment: signed non-zero delta, no repeated products', () => {
    const ok = { ...base(), lines: [{ productId: id(), quantityDelta: -3 }] };
    expect(CreateAdjustmentRequest.safeParse(ok).success).toBe(true);
    expect(CreateAdjustmentRequest.safeParse({ ...ok, lines: [{ productId: id(), quantityDelta: 0 }] }).success).toBe(false);
    const p = id();
    expect(
      CreateAdjustmentRequest.safeParse({ ...ok, lines: [{ productId: p, quantityDelta: 1 }, { productId: p, quantityDelta: -1 }] }).success,
    ).toBe(false);
  });

  it('transfer: origin must differ from destination', () => {
    const from = id();
    const ok = { id: id(), fromLocationId: from, toLocationId: id(), lines: [{ productId: id(), quantity: 1 }] };
    expect(CreateTransferRequest.safeParse(ok).success).toBe(true);
    expect(CreateTransferRequest.safeParse({ ...ok, toLocationId: from }).success).toBe(false);
  });

  it('reversal: id and optional notes', () => {
    expect(CreateReversalRequest.safeParse({ id: id() }).success).toBe(true);
    expect(CreateReversalRequest.safeParse({ id: id(), notes: 'x'.repeat(501) }).success).toBe(false);
  });

  it('occurredAt is an ISO date-time when present', () => {
    const ok = { ...base(), lines: [line()] };
    expect(CreateEntryRequest.safeParse({ ...ok, occurredAt: '2026-11-16T10:00:00.000Z' }).success).toBe(true);
    expect(CreateEntryRequest.safeParse({ ...ok, occurredAt: 'yesterday' }).success).toBe(false);
  });
});

describe('catalog commands', () => {
  it('product: currency and non-negative prices', () => {
    const ok = { name: 'Rice', unitOfMeasure: 'kg', currency: 'CUP', cashPrice: money };
    expect(CreateProductRequest.safeParse(ok).success).toBe(true);
    expect(CreateProductRequest.safeParse({ ...ok, name: '' }).success).toBe(false);
    expect(CreateProductRequest.safeParse({ ...ok, lowStockThreshold: -1 }).success).toBe(false);
  });
  it('location price: null removes the override, Money sets it', () => {
    expect(SetLocationPriceRequest.safeParse({ cashPrice: null, transferPrice: null }).success).toBe(true);
    expect(SetLocationPriceRequest.safeParse({ cashPrice: money, transferPrice: null }).success).toBe(true);
    expect(SetLocationPriceRequest.safeParse({ cashPrice: money }).success).toBe(false);
  });
});

describe('catalog and stock queries and updates', () => {
  it('product update needs at least one field', () => {
    expect(UpdateProductRequest.safeParse({}).success).toBe(false);
    expect(UpdateProductRequest.safeParse({ name: 'Rice' }).success).toBe(true);
    expect(UpdateProductRequest.safeParse({ category: null }).success).toBe(true);
  });
  it('query booleans are parsed from strings and limit is bounded', () => {
    expect(ListProductsQuery.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(ListProductsQuery.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(ListProductsQuery.safeParse({ includeArchived: 'yes' }).success).toBe(false);
    expect(ListProductsQuery.parse({}).limit).toBe(50);
    expect(ListProductsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(StockQuery.parse({ lowStockOnly: 'true' }).lowStockOnly).toBe(true);
    expect(StockQuery.parse({ lowStockOnly: 'false', limit: '5' })).toMatchObject({ lowStockOnly: false, limit: 5 });
  });
});

describe('shared lists', () => {
  it('movement kinds are the eight of the ledger (SP4 adds sale)', () => {
    expect([...INVENTORY_MOVEMENT_KINDS].sort()).toEqual(
      ['adjustment', 'entry', 'owner_withdrawal', 'reversal', 'sale', 'shrinkage', 'transfer_in', 'transfer_out'].sort(),
    );
  });
  it('a sale is also a document kind (SP4 spec, D1)', () => {
    expect([...INVENTORY_DOCUMENT_KINDS].sort()).toEqual(['adjustment', 'entry', 'exit', 'reversal', 'sale', 'transfer'].sort());
  });
  it('error codes cover every SP3 code', () => {
    expect([...INVENTORY_ERROR_CODES].sort()).toEqual(
      ['ALREADY_REVERSED', 'ARCHIVED', 'CONFLICT', 'CURRENCY_MISMATCH', 'IDEMPOTENCY_CONFLICT', 'INSUFFICIENT_STOCK'].sort(),
    );
  });
  it('adds the SP3 permissions and audit event types', () => {
    expect(PERMISSIONS).toContain('catalog:view');
    expect(PERMISSIONS).toContain('inventory:view');
    for (const t of [
      'product_created', 'product_updated', 'product_archived', 'location_price_set', 'inventory_entry_recorded',
      'inventory_exit_recorded', 'inventory_adjustment_recorded', 'inventory_transfer_recorded', 'inventory_document_reversed',
    ]) expect(AUDIT_EVENT_TYPES).toContain(t);
  });
  it('adds the SP4 sale_recorded audit event type (RecordSale)', () => {
    expect(AUDIT_EVENT_TYPES).toContain('sale_recorded');
  });
});

describe('uuidv7', () => {
  it('produces canonical v7 ids that the Uuid contract accepts', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
