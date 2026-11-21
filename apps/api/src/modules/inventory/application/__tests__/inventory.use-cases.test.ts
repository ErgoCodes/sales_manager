import { describe, expect, it } from 'vitest';
import type { CreateAdjustmentRequest, CreateEntryRequest, CreateExitRequest } from '@monaco/contracts';

import { actorWith, at, CASHIER_ROLE, clock, LOC_1, LOC_2, MANAGER_ROLE, NOW, owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import { ArchivedResource, CurrencyMismatch, FutureOccurredAt, IdempotencyConflict, InsufficientStock } from '../../domain/inventory-errors';
import { RecordAdjustment, RecordEntry, RecordExit } from '../inventory.use-cases';
import { activeProduct, DOC_ID, fakeInventory, fakeState, key, PRODUCT_A, PRODUCT_B } from './inventory-fakes';

const request = { actor: owner(), ip: '203.0.113.1' };
const manager = () => actorWith([{ role: MANAGER_ROLE, scope: at(LOC_1) }]);

const entry = (overrides: Partial<CreateEntryRequest> = {}): CreateEntryRequest => ({
  id: DOC_ID,
  locationId: LOC_1,
  lines: [{ productId: PRODUCT_A, quantity: 10, unitCost: { amount: 200, currency: 'CUP' } }],
  ...overrides,
});
const exit = (overrides: Partial<CreateExitRequest> = {}): CreateExitRequest => ({
  id: DOC_ID,
  locationId: LOC_1,
  reason: 'shrinkage',
  lines: [{ productId: PRODUCT_A, quantity: 4 }],
  ...overrides,
});
const adjustment = (quantityDelta: number): CreateAdjustmentRequest => ({
  id: DOC_ID,
  locationId: LOC_1,
  lines: [{ productId: PRODUCT_A, quantityDelta }],
});

describe('the ADR 0006 script', () => {
  it('runs header, share locks, ordered pair locks, sum, writes and audit, in that order', async () => {
    const f = fakeInventory();
    await new RecordEntry(f.uow, clock).execute(request, entry({ lines: [
      { productId: PRODUCT_B, quantity: 1, unitCost: { amount: 5, currency: 'CUP' } },
      { productId: PRODUCT_A, quantity: 2, unitCost: { amount: 5, currency: 'CUP' } },
    ] }));
    expect(f.state.calls).toEqual([
      'insertDocumentHeader',
      'lockLocations',
      'lockProducts',
      'ensureLocationProducts',
      'lockLocationProducts',
      'sumStock',
      'insertMovements',
      'setAverageCost',
      'setAverageCost',
      'audit',
      'findDocument',
    ]);
    // Pairs are created and locked sorted by (location, product), not in line order.
    const sorted = [{ locationId: LOC_1, productId: PRODUCT_A }, { locationId: LOC_1, productId: PRODUCT_B }];
    expect(f.ledger.ensureLocationProducts).toHaveBeenCalledWith(sorted);
    expect(f.ledger.lockLocationProducts).toHaveBeenCalledWith(sorted);
  });

  it('opens one unit of work for the actor tenant', async () => {
    const f = fakeInventory();
    await new RecordExit(f.uow, clock).execute(request, exit());
    expect(f.runs).toEqual([request.actor.tenantId]);
  });
});

describe('RecordEntry', () => {
  it('blends the average cost with the current stock and snapshots the entry cost', async () => {
    const f = fakeInventory(fakeState({ stock: new Map([[key(PRODUCT_A), 10]]), averageCost: new Map([[key(PRODUCT_A), 100]]) }));
    const { document, created } = await new RecordEntry(f.uow, clock).execute(request, entry());
    expect(created).toBe(true);
    expect(f.written[0]!.movements).toEqual([{ locationId: LOC_1, productId: PRODUCT_A, kind: 'entry', quantityDelta: 10, unitCost: 200 }]);
    expect(f.averageCosts).toEqual([{ pair: { locationId: LOC_1, productId: PRODUCT_A }, averageCost: 150 }]);
    expect(document).toMatchObject({
      id: DOC_ID,
      kind: 'entry',
      locationId: LOC_1,
      targetLocationId: null,
      reason: null,
      occurredAt: NOW.toISOString(),
      movements: [{ productId: PRODUCT_A, kind: 'entry', quantityDelta: 10, unitCost: { amount: 200, currency: 'CUP' } }],
    });
  });

  it('defaults occurredAt to now but keeps the one the client sent', async () => {
    const f = fakeInventory();
    await new RecordEntry(f.uow, clock).execute(request, entry({ occurredAt: '2026-11-01T10:00:00.000Z', notes: 'Compra' }));
    expect(f.headers[0]).toMatchObject({ occurredAt: new Date('2026-11-01T10:00:00.000Z'), notes: 'Compra', kind: 'entry', reason: null, createdBy: request.actor.userId });
  });

  it('rejects a future occurredAt before touching data (small clock skew is tolerated)', async () => {
    const f = fakeInventory();
    const useCase = new RecordEntry(f.uow, clock);
    await expect(useCase.execute(request, entry({ occurredAt: '2026-11-05T12:30:00.000Z' }))).rejects.toThrow(FutureOccurredAt);
    expect(f.runs).toEqual([]);
    await expect(useCase.execute(request, entry({ occurredAt: '2026-11-05T12:03:00.000Z' }))).resolves.toBeDefined();
  });

  it('gives ARCHIVED for an archived location or product (D15)', async () => {
    const archivedLocation = fakeInventory(fakeState({ locations: [{ id: LOC_1, archivedAt: NOW }] }));
    await expect(new RecordEntry(archivedLocation.uow, clock).execute(request, entry())).rejects.toEqual(new ArchivedResource('location'));
    expect(archivedLocation.written).toEqual([]);
    const archivedProduct = fakeInventory(fakeState({ products: [activeProduct(PRODUCT_A, 'CUP', true)] }));
    await expect(new RecordEntry(archivedProduct.uow, clock).execute(request, entry())).rejects.toEqual(new ArchivedResource('product'));
  });

  it('gives CURRENCY_MISMATCH when the unit cost is not in the product currency', async () => {
    const f = fakeInventory(fakeState({ products: [activeProduct(PRODUCT_A, 'USD')] }));
    await expect(new RecordEntry(f.uow, clock).execute(request, entry())).rejects.toEqual(new CurrencyMismatch(PRODUCT_A));
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('is a 404 for a missing product or location', async () => {
    await expect(new RecordEntry(fakeInventory(fakeState({ products: [] })).uow, clock).execute(request, entry())).rejects.toThrow(ResourceNotFound);
    await expect(new RecordEntry(fakeInventory(fakeState({ locations: [] })).uow, clock).execute(request, entry())).rejects.toThrow(ResourceNotFound);
  });

  it('audits one event per document, never costs', async () => {
    const f = fakeInventory();
    await new RecordEntry(f.uow, clock).execute(request, entry({ notes: 'x' }));
    expect(f.audit.record).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledWith({
      type: 'inventory_entry_recorded',
      actorUserId: request.actor.userId,
      targetType: 'inventory_document',
      targetId: DOC_ID,
      metadata: { locationId: LOC_1, lineCount: 1 },
      ip: '203.0.113.1',
    });
  });
});

describe('RecordExit', () => {
  it('writes negative deltas of the reason kind, valued at the average cost, without moving it', async () => {
    const f = fakeInventory(fakeState({ stock: new Map([[key(PRODUCT_A), 10]]), averageCost: new Map([[key(PRODUCT_A), 120.5]]) }));
    const { document } = await new RecordExit(f.uow, clock).execute(request, exit({ reason: 'owner_withdrawal' }));
    expect(f.written[0]!.movements).toEqual([{ locationId: LOC_1, productId: PRODUCT_A, kind: 'owner_withdrawal', quantityDelta: -4, unitCost: 120.5 }]);
    expect(f.averageCosts).toEqual([]);
    expect(document.reason).toBe('owner_withdrawal');
    expect(f.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory_exit_recorded', metadata: { locationId: LOC_1, lineCount: 1, reason: 'owner_withdrawal' } }));
  });

  it('allows draining to exactly zero and uses thousandths (0.1 + 0.2 - 0.3)', async () => {
    const f = fakeInventory(fakeState({ stock: new Map([[key(PRODUCT_A), 0.30000000000000004]]) }));
    await expect(new RecordExit(f.uow, clock).execute(request, exit({ lines: [{ productId: PRODUCT_A, quantity: 0.3 }] }))).resolves.toBeDefined();
  });

  it('reports every short product and writes nothing', async () => {
    const f = fakeInventory(fakeState({ stock: new Map([[key(PRODUCT_A), 3], [key(PRODUCT_B), 9]]) }));
    const body = exit({ lines: [{ productId: PRODUCT_A, quantity: 4 }, { productId: PRODUCT_B, quantity: 10 }] });
    const error = await new RecordExit(f.uow, clock).execute(request, body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientStock);
    expect((error as InsufficientStock).shortages).toEqual([
      { productId: PRODUCT_A, available: 3, shortBy: 1 },
      { productId: PRODUCT_B, available: 9, shortBy: 1 },
    ]);
    expect(f.written).toEqual([]);
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('works on an archived location and product (they can be drained)', async () => {
    const f = fakeInventory(fakeState({ locations: [{ id: LOC_1, archivedAt: NOW }], products: [activeProduct(PRODUCT_A, 'CUP', true)], stock: new Map([[key(PRODUCT_A), 5]]) }));
    await expect(new RecordExit(f.uow, clock).execute(request, exit())).resolves.toBeDefined();
  });
});

describe('RecordAdjustment', () => {
  it('keeps the sign the client sent and checks the stock only for decreases', async () => {
    const up = fakeInventory();
    await new RecordAdjustment(up.uow, clock).execute(request, adjustment(2.5));
    expect(up.written[0]!.movements).toEqual([{ locationId: LOC_1, productId: PRODUCT_A, kind: 'adjustment', quantityDelta: 2.5, unitCost: 0 }]);
    expect(up.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory_adjustment_recorded' }));

    const down = fakeInventory(fakeState({ stock: new Map([[key(PRODUCT_A), 1]]) }));
    await expect(new RecordAdjustment(down.uow, clock).execute(request, adjustment(-1.001))).rejects.toBeInstanceOf(InsufficientStock);
    await expect(new RecordAdjustment(fakeInventory(fakeState({ stock: new Map([[key(PRODUCT_A), 1]]) })).uow, clock).execute(request, adjustment(-1))).resolves.toBeDefined();
  });
});

describe('authorization (before any data is touched)', () => {
  it.each([
    ['entry', (f: ReturnType<typeof fakeInventory>, who: { actor: ReturnType<typeof owner>; ip: string | null }) => new RecordEntry(f.uow, clock).execute(who, entry({ locationId: LOC_2 }))],
    ['exit', (f: ReturnType<typeof fakeInventory>, who: { actor: ReturnType<typeof owner>; ip: string | null }) => new RecordExit(f.uow, clock).execute(who, exit({ locationId: LOC_2 }))],
    ['adjustment', (f: ReturnType<typeof fakeInventory>, who: { actor: ReturnType<typeof owner>; ip: string | null }) => new RecordAdjustment(f.uow, clock).execute(who, { ...adjustment(1), locationId: LOC_2 })],
  ])('%s: inventory:write is required in the document location', async (_name, run) => {
    const f = fakeInventory();
    await expect(run(f, { actor: manager(), ip: null })).rejects.toThrow(PermissionDenied);
    expect(f.runs).toEqual([]);
  });

  it('a cashier cannot write anywhere, and a locations-scoped manager can in their location', async () => {
    const f = fakeInventory();
    const cashier = actorWith([{ role: CASHIER_ROLE, scope: at(LOC_1) }]);
    await expect(new RecordExit(f.uow, clock).execute({ actor: cashier, ip: null }, exit())).rejects.toThrow(PermissionDenied);
    await expect(new RecordExit(f.uow, clock).execute({ actor: manager(), ip: null }, exit())).resolves.toBeDefined();
  });
});

describe('idempotency by client id', () => {
  it('a retry with the same content returns the stored document without locking, writing or auditing', async () => {
    const first = fakeInventory();
    await new RecordExit(first.uow, clock).execute(request, exit());
    const stored = await first.ledger.findDocument(DOC_ID);

    const retry = fakeInventory(fakeState({ inserted: false, existing: stored }));
    const { document, created } = await new RecordExit(retry.uow, clock).execute(request, exit());
    expect(created).toBe(false);
    expect(document.id).toBe(DOC_ID);
    expect(retry.state.calls).toEqual(['insertDocumentHeader', 'findDocument']);
    expect(retry.audit.record).not.toHaveBeenCalled();
  });

  it('hashes the body as sent: a retry without occurredAt later still matches', async () => {
    const first = fakeInventory();
    await new RecordEntry(first.uow, clock).execute(request, entry());
    const stored = await first.ledger.findDocument(DOC_ID);
    const later = { now: () => new Date(NOW.getTime() + 60_000) };
    const retry = fakeInventory(fakeState({ inserted: false, existing: stored }));
    await expect(new RecordEntry(retry.uow, later).execute(request, entry())).resolves.toMatchObject({ created: false });
  });

  it('the hash ignores key order but not content, kind or location', async () => {
    const first = fakeInventory();
    await new RecordEntry(first.uow, clock).execute(request, entry());
    const hash = (first.headers[0] as { payloadHash: string }).payloadHash;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const reordered = fakeInventory();
    await new RecordEntry(reordered.uow, clock).execute(request, {
      lines: [{ unitCost: { currency: 'CUP', amount: 200 }, quantity: 10, productId: PRODUCT_A }],
      locationId: LOC_1,
      id: DOC_ID,
    });
    expect((reordered.headers[0] as { payloadHash: string }).payloadHash).toBe(hash);

    const other = fakeInventory();
    await new RecordEntry(other.uow, clock).execute(request, entry({ notes: 'otra' }));
    expect((other.headers[0] as { payloadHash: string }).payloadHash).not.toBe(hash);
    const asExit = fakeInventory();
    await new RecordExit(asExit.uow, clock).execute(request, exit({ lines: [{ productId: PRODUCT_A, quantity: 10 }] }));
    expect((asExit.headers[0] as { payloadHash: string }).payloadHash).not.toBe(hash);
  });

  it('IDEMPOTENCY_CONFLICT for the same id with other content, and for an id nobody in this tenant can see', async () => {
    const first = fakeInventory();
    await new RecordExit(first.uow, clock).execute(request, exit());
    const stored = await first.ledger.findDocument(DOC_ID);

    const changed = fakeInventory(fakeState({ inserted: false, existing: stored }));
    await expect(new RecordExit(changed.uow, clock).execute(request, exit({ notes: 'distinto' }))).rejects.toBeInstanceOf(IdempotencyConflict);
    const foreign = fakeInventory(fakeState({ inserted: false, existing: null }));
    await expect(new RecordExit(foreign.uow, clock).execute(request, exit())).rejects.toBeInstanceOf(IdempotencyConflict);
    expect(foreign.audit.record).not.toHaveBeenCalled();
  });
});
