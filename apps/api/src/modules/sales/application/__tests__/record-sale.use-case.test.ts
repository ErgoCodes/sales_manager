import { saleLineAmounts } from '@monaco/domain';
import { describe, expect, it, vi } from 'vitest';

import { ACTOR_ID, actorWith, at, CASHIER_ROLE, clock, custom, LOC_1, LOC_2, NOW, owner, TENANT } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import { activeProduct, CREATED_AT, DOC_ID, fakeInventory, type FakeState, fakeState, key, PRODUCT_A, PRODUCT_B } from '../../../inventory/application/__tests__/inventory-fakes';
import { CurrencyMismatch, FutureOccurredAt, IdempotencyConflict, InsufficientStock } from '../../../inventory/domain/inventory-errors';
import type { StoredDocument } from '../../../inventory/domain/inventory-ports';
import { InvalidSaleCommand, type RecordSaleCommand } from '../../domain/sale-command';
import type { NewSaleHeader, NewSaleLine, SalesScope, SalesUnitOfWork, StoredSale } from '../../domain/sales-ports';
import { RecordSale } from '../record-sale.use-case';

const request = { actor: owner(), ip: '203.0.113.1' };
const cup = (amount: number) => ({ amount, currency: 'CUP' as const });

const line = (productId: string, overrides: Partial<RecordSaleCommand['lines'][number]> = {}): RecordSaleCommand['lines'][number] => ({
  productId,
  quantity: 2,
  unitPrice: cup(150),
  discountPercent: 0,
  paymentMethod: 'cash',
  isCostSale: false,
  ...overrides,
});
const sale = (overrides: Partial<RecordSaleCommand> = {}): RecordSaleCommand => ({ id: DOC_ID, locationId: LOC_1, lines: [line(PRODUCT_A)], ...overrides });

/** The inventory fakes plus an in-memory `sales` table that records its calls in the same list. */
function fakeSales(state: FakeState = fakeState(), stored: StoredSale | null = null) {
  const inventory = fakeInventory(state);
  const inserted: { header: NewSaleHeader; lines: readonly NewSaleLine[] }[] = [];
  const sales = {
    insert: vi.fn(async (header: NewSaleHeader, lines: readonly NewSaleLine[]) => {
      state.calls.push('insertSale');
      inserted.push({ header, lines });
    }),
    find: vi.fn(async (id: string): Promise<StoredSale | null> => {
      state.calls.push('findSale');
      const mine = inserted.find((row) => row.header.id === id);
      if (mine) return { ...mine.header, deviceId: null, createdAt: CREATED_AT, lines: mine.lines.map((l, i) => ({ ...l, id: `line-${i}` })) };
      return stored;
    }),
  };
  const runs: string[] = [];
  const scope: SalesScope = { ledger: inventory.ledger, reader: inventory.reader, audit: inventory.audit, sales };
  const uow: SalesUnitOfWork = {
    run: async (tenantId, work) => {
      runs.push(tenantId);
      return work(scope);
    },
  };
  return { ...inventory, uow, sales, inserted, runs };
}

describe('RecordSale: authority and validation before any data', () => {
  it('without sales:create in the location: PermissionDenied and no unit of work', async () => {
    const f = fakeSales();
    const cashierElsewhere = { actor: actorWith([{ role: CASHIER_ROLE, scope: at(LOC_2) }]), ip: null };
    await expect(new RecordSale(f.uow, clock).execute(cashierElsewhere, sale())).rejects.toBeInstanceOf(PermissionDenied);
    const inventoryWriter = { actor: actorWith([{ role: custom('writer', 'inventory:write'), scope: at(LOC_1) }]), ip: null };
    await expect(new RecordSale(f.uow, clock).execute(inventoryWriter, sale())).rejects.toBeInstanceOf(PermissionDenied);
    expect(f.runs).toEqual([]);
    expect(f.state.calls).toEqual([]);
  });

  it('a cashier of the location may record it, and is its cashier', async () => {
    const f = fakeSales();
    const cashier = { actor: actorWith([{ role: CASHIER_ROLE, scope: at(LOC_1) }], ACTOR_ID), ip: null };
    const { sale: stored, created } = await new RecordSale(f.uow, clock).execute(cashier, sale());
    expect(created).toBe(true);
    expect(stored.cashierUserId).toBe(ACTOR_ID);
    expect(f.runs).toEqual([TENANT]);
  });

  it.each([
    ['no lines', sale({ lines: [] })],
    ['a repeated product', sale({ lines: [line(PRODUCT_A), line(PRODUCT_A)] })],
    ['a zero quantity', sale({ lines: [line(PRODUCT_A, { quantity: 0 })] })],
    ['a fractional price', sale({ lines: [line(PRODUCT_A, { unitPrice: cup(1.5) })] })],
    ['a discount over 100', sale({ lines: [line(PRODUCT_A, { discountPercent: 101 })] })],
    ['a discount with 3 decimals', sale({ lines: [line(PRODUCT_A, { discountPercent: 1.005 })] })],
    ['an unknown payment method', sale({ lines: [line(PRODUCT_A, { paymentMethod: 'card' as never })] })],
    ['an unknown field', { ...sale(), deviceId: DOC_ID } as RecordSaleCommand],
  ])('rejects %s with InvalidSaleCommand before authorizing or opening a transaction', async (_name, command) => {
    const f = fakeSales();
    const nobody = { actor: actorWith([]), ip: null };
    await expect(new RecordSale(f.uow, clock).execute(nobody, command)).rejects.toBeInstanceOf(InvalidSaleCommand);
    expect(f.runs).toEqual([]);
  });

  it('an occurredAt in the future: FutureOccurredAt, nothing written', async () => {
    const f = fakeSales();
    const future = new Date(NOW.getTime() + 10 * 60_000).toISOString();
    await expect(new RecordSale(f.uow, clock).execute(request, sale({ occurredAt: future }))).rejects.toBeInstanceOf(FutureOccurredAt);
    expect(f.state.calls).toEqual([]);
  });
});

describe('RecordSale: the ADR 0006 script', () => {
  it('locks in the global order the port is asked for, then writes movements, sales and the audit event', async () => {
    const f = fakeSales();
    await new RecordSale(f.uow, clock).execute(request, sale({ lines: [line(PRODUCT_B), line(PRODUCT_A)] }));
    expect(f.state.calls).toEqual([
      'insertDocumentHeader',
      'lockLocations',
      'lockProducts',
      'ensureLocationProducts',
      'lockLocationProducts',
      'sumStock',
      'insertMovements',
      'insertSale',
      'audit',
      'findDocument',
      'findSale',
    ]);
    const sorted = [{ locationId: LOC_1, productId: PRODUCT_A }, { locationId: LOC_1, productId: PRODUCT_B }];
    expect(f.ledger.ensureLocationProducts).toHaveBeenCalledWith(sorted);
    expect(f.ledger.lockLocationProducts).toHaveBeenCalledWith(sorted);
    expect(f.ledger.setAverageCost).not.toHaveBeenCalled();
  });

  it('writes a sale document whose header the sales row copies, at the business date', async () => {
    const f = fakeSales();
    const occurredAt = '2026-11-05T09:30:00.000Z';
    await new RecordSale(f.uow, clock).execute(request, sale({ occurredAt }));
    const header = f.headers[0] as { kind: string; locationId: string; occurredAt: Date; payloadHash: string; createdBy: string; reason: null };
    expect(header).toMatchObject({ kind: 'sale', locationId: LOC_1, occurredAt: new Date(occurredAt), createdBy: ACTOR_ID, reason: null });
    expect(f.inserted[0]!.header).toEqual({ id: DOC_ID, locationId: LOC_1, cashierUserId: ACTOR_ID, occurredAt: new Date(occurredAt), payloadHash: header.payloadHash });
  });

  it('defaults occurredAt to now', async () => {
    const f = fakeSales();
    await new RecordSale(f.uow, clock).execute(request, sale());
    expect(f.inserted[0]!.header.occurredAt).toEqual(NOW);
  });

  it('values each line at effectiveUnitCost under the lock and stores the amounts of saleLineAmounts', async () => {
    // A: average 80.5 (it wins over the cost price); B: no average yet, so its cost price (60).
    const state = fakeState({
      products: [activeProduct(PRODUCT_A, 'CUP', false, 70), activeProduct(PRODUCT_B, 'CUP', false, 60)],
      averageCost: new Map([[key(PRODUCT_A), 80.5]]),
    });
    const f = fakeSales(state);
    const lines = [
      line(PRODUCT_A, { quantity: 1.5, unitPrice: cup(133), discountPercent: 5, paymentMethod: 'transfer' }),
      line(PRODUCT_B, { quantity: 3, unitPrice: cup(60), isCostSale: true }),
    ];
    const { sale: stored } = await new RecordSale(f.uow, clock).execute(request, sale({ lines }));

    expect(f.written[0]!.movements).toEqual([
      { locationId: LOC_1, productId: PRODUCT_A, kind: 'sale', quantityDelta: -1.5, unitCost: 80.5 },
      { locationId: LOC_1, productId: PRODUCT_B, kind: 'sale', quantityDelta: -3, unitCost: 60 },
    ]);
    expect(f.inserted[0]!.lines).toEqual([
      {
        productId: PRODUCT_A, currency: 'CUP', quantity: 1.5, unitPrice: 133, discountPercent: 5, paymentMethod: 'transfer', isCostSale: false, unitCost: 80.5,
        ...saleLineAmounts({ quantity: 1.5, unitPrice: 133, unitCost: 80.5, isCostSale: false }),
      },
      {
        productId: PRODUCT_B, currency: 'CUP', quantity: 3, unitPrice: 60, discountPercent: 0, paymentMethod: 'cash', isCostSale: true, unitCost: 60,
        ...saleLineAmounts({ quantity: 3, unitPrice: 60, unitCost: 60, isCostSale: true }),
      },
    ]);
    // round(1.5 × 133) = 200 (199.5 half up); 200 − 1.5 × 80.5 = 79.25.
    expect(stored.lines[0]).toMatchObject({ lineTotal: 200, profit: 79.25 });
    expect(stored.lines[1]).toMatchObject({ lineTotal: 180, profit: 0 });
  });

  it('a product without average nor cost price is valued at 0', async () => {
    const f = fakeSales();
    await new RecordSale(f.uow, clock).execute(request, sale());
    expect(f.inserted[0]!.lines[0]).toMatchObject({ unitCost: 0, lineTotal: 300, profit: 300 });
  });

  it('audits sale_recorded with the location and line count, never amounts', async () => {
    const f = fakeSales();
    await new RecordSale(f.uow, clock).execute(request, sale({ lines: [line(PRODUCT_A), line(PRODUCT_B)] }));
    expect(f.audit.record).toHaveBeenCalledWith({
      type: 'sale_recorded',
      actorUserId: ACTOR_ID,
      targetType: 'inventory_document',
      targetId: DOC_ID,
      metadata: { locationId: LOC_1, lineCount: 2 },
      ip: '203.0.113.1',
    });
  });

  it('a line that does not fit: InsufficientStock with every shortage, and no movement, sale or audit', async () => {
    const f = fakeSales(fakeState({ stock: new Map([[key(PRODUCT_A), 1]]) }));
    const error = await new RecordSale(f.uow, clock)
      .execute(request, sale({ lines: [line(PRODUCT_A, { quantity: 2 }), line(PRODUCT_B, { quantity: 1 })] }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientStock);
    expect((error as InsufficientStock).shortages).toEqual([
      { productId: PRODUCT_A, available: 1, shortBy: 1 },
      { productId: PRODUCT_B, available: 0, shortBy: 1 },
    ]);
    expect(f.state.calls).not.toContain('insertMovements');
    expect(f.sales.insert).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('a price in another currency than the product: CurrencyMismatch before locking the pairs', async () => {
    const f = fakeSales();
    await expect(
      new RecordSale(f.uow, clock).execute(request, sale({ lines: [line(PRODUCT_A, { unitPrice: { amount: 1, currency: 'USD' } })] })),
    ).rejects.toBeInstanceOf(CurrencyMismatch);
    expect(f.state.calls).not.toContain('lockLocationProducts');
  });
});

describe('RecordSale: idempotency by id + payload_hash', () => {
  async function firstWrite(command: RecordSaleCommand) {
    const f = fakeSales();
    const result = await new RecordSale(f.uow, clock).execute(request, command);
    const header = f.headers[0] as Omit<StoredDocument, 'id' | 'locationName' | 'targetLocationName' | 'createdAt' | 'movements'>;
    const document: StoredDocument = { id: command.id, ...header, locationName: 'Location 1', targetLocationName: null, createdAt: CREATED_AT, movements: [] };
    return { result, document };
  }

  it('the same id and content: the stored sale, created false, and nothing written', async () => {
    const { result, document } = await firstWrite(sale());
    const f = fakeSales(fakeState({ inserted: false, existing: document }), result.sale);
    const retry = await new RecordSale(f.uow, clock).execute(request, sale());
    expect(retry).toEqual({ sale: result.sale, created: false });
    expect(f.state.calls).toEqual(['insertDocumentHeader', 'findDocument', 'findSale']);
    expect(f.sales.insert).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('a retry without occurredAt still matches (the hash is taken before the default)', async () => {
    const { result, document } = await firstWrite(sale());
    const f = fakeSales(fakeState({ inserted: false, existing: document }), result.sale);
    const later = { now: () => new Date(NOW.getTime() + 60_000) };
    await expect(new RecordSale(f.uow, later).execute(request, sale())).resolves.toMatchObject({ created: false });
  });

  it('the same id with other content: IdempotencyConflict and nothing written', async () => {
    const { document } = await firstWrite(sale());
    const f = fakeSales(fakeState({ inserted: false, existing: document }));
    await expect(new RecordSale(f.uow, clock).execute(request, sale({ lines: [line(PRODUCT_A, { quantity: 3 })] }))).rejects.toBeInstanceOf(IdempotencyConflict);
    expect(f.sales.insert).not.toHaveBeenCalled();
  });

  it('the id of an inventory document of another kind: IdempotencyConflict (the kind is part of the hash)', async () => {
    const { document } = await firstWrite(sale());
    const f = fakeSales(fakeState({ inserted: false, existing: { ...document, kind: 'exit', payloadHash: 'exit-hash' } }));
    await expect(new RecordSale(f.uow, clock).execute(request, sale())).rejects.toBeInstanceOf(IdempotencyConflict);
  });
});
