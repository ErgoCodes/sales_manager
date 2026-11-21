import type { CreateTransferRequest } from '@monaco/contracts';
import { averageCostAfterTransferIn, replayAverageCost } from '@monaco/domain';
import { describe, expect, it } from 'vitest';

import { actorWith, at, clock, custom, LOC_1, LOC_2, MANAGER_ROLE, NOW, owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import { AlreadyReversed, ArchivedResource, IdempotencyConflict, InsufficientStock } from '../../domain/inventory-errors';
import type { StoredDocument, StoredMovement } from '../../domain/inventory-ports';
import { RecordTransfer, ReverseDocument } from '../inventory.use-cases';
import { payloadHash } from '../payload-hash';
import { activeProduct, CREATED_AT, DOC_ID, fakeInventory, fakeState, key, PRODUCT_A, PRODUCT_B } from './inventory-fakes';

const request = { actor: owner(), ip: '203.0.113.1' };
const ORIGINAL_ID = '0190a000-0000-7000-8000-0000000000f1';
const bothLocations = [
  { id: LOC_1, archivedAt: null },
  { id: LOC_2, archivedAt: null },
];

const transfer = (overrides: Partial<CreateTransferRequest> = {}): CreateTransferRequest => ({
  id: DOC_ID,
  fromLocationId: LOC_1,
  toLocationId: LOC_2,
  lines: [{ productId: PRODUCT_A, quantity: 4 }],
  ...overrides,
});

const movement = (over: Partial<StoredMovement> & Pick<StoredMovement, 'id' | 'locationId' | 'kind' | 'quantityDelta' | 'unitCost'>): StoredMovement => ({
  documentId: ORIGINAL_ID,
  productId: PRODUCT_A,
  currency: 'CUP',
  reversesMovementId: null,
  createdAt: CREATED_AT,
  ...over,
});

const stored = (over: Partial<StoredDocument> & Pick<StoredDocument, 'kind' | 'movements'>): StoredDocument => ({
  id: ORIGINAL_ID,
  locationId: LOC_1,
  locationName: 'Location 1',
  targetLocationId: null,
  targetLocationName: null,
  reason: null,
  reversesDocumentId: null,
  occurredAt: CREATED_AT,
  notes: null,
  payloadHash: 'h',
  createdBy: 'u',
  createdAt: CREATED_AT,
  ...over,
});

const storedEntry = () => stored({ kind: 'entry', movements: [movement({ id: 'm1', locationId: LOC_1, kind: 'entry', quantityDelta: 10, unitCost: 100 })] });
const storedTransfer = () =>
  stored({
    kind: 'transfer',
    targetLocationId: LOC_2,
    targetLocationName: 'Location 2',
    movements: [
      movement({ id: 'm1', locationId: LOC_1, kind: 'transfer_out', quantityDelta: -4, unitCost: 100 }),
      movement({ id: 'm2', locationId: LOC_2, kind: 'transfer_in', quantityDelta: 4, unitCost: 100 }),
    ],
  });

describe('RecordTransfer', () => {
  it('writes transfer_out in the origin and transfer_in in the destination, valued and blended with the origin cost', async () => {
    const f = fakeInventory(
      fakeState({
        locations: bothLocations,
        stock: new Map([
          [key(PRODUCT_A, LOC_1), 10],
          [key(PRODUCT_A, LOC_2), 6],
        ]),
        averageCost: new Map([
          [key(PRODUCT_A, LOC_1), 100],
          [key(PRODUCT_A, LOC_2), 50],
        ]),
      }),
    );
    const { document, created } = await new RecordTransfer(f.uow, clock).execute(request, transfer());
    expect(created).toBe(true);
    expect(f.headers[0]).toMatchObject({ kind: 'transfer', locationId: LOC_1, targetLocationId: LOC_2, reason: null, reversesDocumentId: null, occurredAt: NOW });
    expect(f.written[0]!.movements).toEqual([
      { locationId: LOC_1, productId: PRODUCT_A, kind: 'transfer_out', quantityDelta: -4, unitCost: 100 },
      { locationId: LOC_2, productId: PRODUCT_A, kind: 'transfer_in', quantityDelta: 4, unitCost: 100 },
    ]);
    // Only the destination moves its average; the origin's stays (transfer_out does not blend).
    expect(f.averageCosts).toEqual([{ pair: { locationId: LOC_2, productId: PRODUCT_A }, averageCost: averageCostAfterTransferIn(6, 50, 4, 100) }]);
    expect(document).toMatchObject({ kind: 'transfer', locationId: LOC_1, targetLocationId: LOC_2, targetLocationName: 'Location 2' });
  });

  it('locks both locations and every pair of the two ends in one global (location, product) order', async () => {
    // Reversed direction and line order: the lock order must not depend on either.
    const f2 = fakeInventory(fakeState({ locations: bothLocations, stock: new Map([[key(PRODUCT_A, LOC_2), 5], [key(PRODUCT_B, LOC_2), 5]]) }));
    await new RecordTransfer(f2.uow, clock).execute(request, transfer({ fromLocationId: LOC_2, toLocationId: LOC_1, lines: [{ productId: PRODUCT_B, quantity: 1 }, { productId: PRODUCT_A, quantity: 1 }] }));
    const sorted = [
      { locationId: LOC_1, productId: PRODUCT_A },
      { locationId: LOC_1, productId: PRODUCT_B },
      { locationId: LOC_2, productId: PRODUCT_A },
      { locationId: LOC_2, productId: PRODUCT_B },
    ];
    expect(f2.ledger.lockLocations).toHaveBeenCalledWith([LOC_2, LOC_1]);
    expect(f2.ledger.ensureLocationProducts).toHaveBeenCalledWith(sorted);
    expect(f2.ledger.lockLocationProducts).toHaveBeenCalledWith(sorted);
  });

  it('is atomic: a short origin fails the whole document and writes nothing', async () => {
    const f = fakeInventory(fakeState({ locations: bothLocations, stock: new Map([[key(PRODUCT_A, LOC_1), 3], [key(PRODUCT_B, LOC_1), 10]]) }));
    const body = transfer({ lines: [{ productId: PRODUCT_B, quantity: 2 }, { productId: PRODUCT_A, quantity: 4 }] });
    const error = await new RecordTransfer(f.uow, clock).execute(request, body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientStock);
    expect((error as InsufficientStock).shortages).toEqual([{ productId: PRODUCT_A, available: 3, shortBy: 1 }]);
    expect(f.ledger.insertMovements).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('needs inventory:transfer in the origin and in the destination, before any data is touched', async () => {
    const onlyOrigin = actorWith([{ role: MANAGER_ROLE, scope: at(LOC_1) }]);
    const onlyDestination = actorWith([{ role: MANAGER_ROLE, scope: at(LOC_2) }]);
    const writerBoth = actorWith([{ role: custom('w', 'inventory:write'), scope: at(LOC_1, LOC_2) }]);
    for (const actor of [onlyOrigin, onlyDestination, writerBoth]) {
      const f = fakeInventory(fakeState({ locations: bothLocations }));
      await expect(new RecordTransfer(f.uow, clock).execute({ actor, ip: null }, transfer())).rejects.toBeInstanceOf(PermissionDenied);
      expect(f.runs).toEqual([]);
    }
    const both = actorWith([{ role: MANAGER_ROLE, scope: at(LOC_1, LOC_2) }]);
    const f = fakeInventory(fakeState({ locations: bothLocations }));
    await expect(new RecordTransfer(f.uow, clock).execute({ actor: both, ip: null }, transfer())).resolves.toBeDefined();
  });

  it('D15: an archived origin can be drained; an archived destination or product gives ARCHIVED', async () => {
    const archivedOrigin = fakeInventory(fakeState({ locations: [{ id: LOC_1, archivedAt: NOW }, { id: LOC_2, archivedAt: null }] }));
    await expect(new RecordTransfer(archivedOrigin.uow, clock).execute(request, transfer())).resolves.toBeDefined();

    const archivedDestination = fakeInventory(fakeState({ locations: [{ id: LOC_1, archivedAt: null }, { id: LOC_2, archivedAt: NOW }] }));
    await expect(new RecordTransfer(archivedDestination.uow, clock).execute(request, transfer())).rejects.toEqual(new ArchivedResource('location'));

    const archivedProduct = fakeInventory(fakeState({ locations: bothLocations, products: [activeProduct(PRODUCT_A, 'CUP', true)] }));
    await expect(new RecordTransfer(archivedProduct.uow, clock).execute(request, transfer())).rejects.toEqual(new ArchivedResource('product'));
  });

  it('is a 404 when a location is missing (or of another tenant)', async () => {
    const f = fakeInventory(fakeState({ locations: [{ id: LOC_1, archivedAt: null }] }));
    await expect(new RecordTransfer(f.uow, clock).execute(request, transfer())).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('audits one event with both locations and the line count, never costs', async () => {
    const f = fakeInventory(fakeState({ locations: bothLocations }));
    await new RecordTransfer(f.uow, clock).execute(request, transfer({ notes: 'Reparto' }));
    expect(f.audit.record).toHaveBeenCalledWith({
      type: 'inventory_transfer_recorded',
      actorUserId: request.actor.userId,
      targetType: 'inventory_document',
      targetId: DOC_ID,
      metadata: { fromLocationId: LOC_1, toLocationId: LOC_2, lineCount: 1 },
      ip: request.ip,
    });
  });

  it('a retry with the same content returns the stored transfer; other content is IDEMPOTENCY_CONFLICT', async () => {
    const first = fakeInventory(fakeState({ locations: bothLocations }));
    const { document } = await new RecordTransfer(first.uow, clock).execute(request, transfer());
    const existing = await first.ledger.findDocument(DOC_ID);
    const retry = fakeInventory(fakeState({ inserted: false, existing }));
    await expect(new RecordTransfer(retry.uow, clock).execute(request, transfer())).resolves.toEqual({ document, created: false });
    const changed = fakeInventory(fakeState({ inserted: false, existing }));
    await expect(new RecordTransfer(changed.uow, clock).execute(request, transfer({ lines: [{ productId: PRODUCT_A, quantity: 5 }] }))).rejects.toBeInstanceOf(
      IdempotencyConflict,
    );
    // A missing id that is not a reversal stays an idempotency conflict (another tenant's id).
    const foreign = fakeInventory(fakeState({ inserted: false, reversalOf: 'whatever' }));
    await expect(new RecordTransfer(foreign.uow, clock).execute(request, transfer())).rejects.toBeInstanceOf(IdempotencyConflict);
    expect(foreign.ledger.findReversalOf).not.toHaveBeenCalled();
  });
});

describe('ReverseDocument', () => {
  const reversal = { id: DOC_ID, notes: 'Error de carga' };

  it('writes the exact opposite of every movement at its cost, linked to it, and replays the average of a reversed entry', async () => {
    const original = storedEntry();
    const f = fakeInventory(
      fakeState({
        documents: [original],
        stock: new Map([[key(PRODUCT_A), 15]]),
        averageCost: new Map([[key(PRODUCT_A), 80]]),
        ledgers: new Map([
          [
            key(PRODUCT_A),
            [
              { documentId: 'before', kind: 'entry', quantityDelta: 5, unitCost: 40, reversesDocumentId: null },
              { documentId: ORIGINAL_ID, kind: 'entry', quantityDelta: 10, unitCost: 100, reversesDocumentId: null },
            ],
          ],
        ]),
      }),
    );
    const { document, created } = await new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal);
    expect(created).toBe(true);
    expect(f.headers[0]).toMatchObject({ kind: 'reversal', locationId: LOC_1, targetLocationId: null, reason: null, reversesDocumentId: ORIGINAL_ID, occurredAt: NOW, notes: 'Error de carga' });
    expect(f.written[0]!.movements).toEqual([{ locationId: LOC_1, productId: PRODUCT_A, kind: 'reversal', quantityDelta: -10, unitCost: 100, reversesMovementId: 'm1' }]);
    // The replay skips the reversed entry: only the one before it remains.
    expect(f.averageCosts).toEqual([{ pair: { locationId: LOC_1, productId: PRODUCT_A }, averageCost: 40 }]);
    expect(document).toMatchObject({ kind: 'reversal', reversesDocumentId: ORIGINAL_ID, movements: [{ kind: 'reversal', quantityDelta: -10, reversesMovementId: 'm1' }] });
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inventory_document_reversed', targetId: DOC_ID, metadata: { reversesDocumentId: ORIGINAL_ID, locationIds: [LOC_1], lineCount: 1 } }),
    );
  });

  it('a reversed transfer restores both ends; only the destination replays its average (the origin keeps its own)', async () => {
    const f = fakeInventory(
      fakeState({
        documents: [storedTransfer()],
        locations: bothLocations,
        stock: new Map([
          [key(PRODUCT_A, LOC_1), 6],
          [key(PRODUCT_A, LOC_2), 9],
        ]),
        ledgers: new Map([
          [
            key(PRODUCT_A, LOC_2),
            [
              { documentId: 'e', kind: 'entry', quantityDelta: 5, unitCost: 300, reversesDocumentId: null },
              { documentId: ORIGINAL_ID, kind: 'transfer_in', quantityDelta: 4, unitCost: 100, reversesDocumentId: null },
            ],
          ],
        ]),
      }),
    );
    await new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal);
    expect(f.written[0]!.movements).toEqual([
      { locationId: LOC_1, productId: PRODUCT_A, kind: 'reversal', quantityDelta: 4, unitCost: 100, reversesMovementId: 'm1' },
      { locationId: LOC_2, productId: PRODUCT_A, kind: 'reversal', quantityDelta: -4, unitCost: 100, reversesMovementId: 'm2' },
    ]);
    expect(f.ledger.pairLedger).toHaveBeenCalledTimes(1);
    expect(f.averageCosts).toEqual([{ pair: { locationId: LOC_2, productId: PRODUCT_A }, averageCost: 300 }]);
    expect(f.ledger.lockLocationProducts).toHaveBeenCalledWith([
      { locationId: LOC_1, productId: PRODUCT_A },
      { locationId: LOC_2, productId: PRODUCT_A },
    ]);
  });

  it('a reversed exit puts the stock back without touching the average', async () => {
    const exit = stored({ kind: 'exit', reason: 'shrinkage', movements: [movement({ id: 'm1', locationId: LOC_1, kind: 'shrinkage', quantityDelta: -2, unitCost: 80 })] });
    const f = fakeInventory(fakeState({ documents: [exit] }));
    await new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal);
    expect(f.written[0]!.movements).toEqual([{ locationId: LOC_1, productId: PRODUCT_A, kind: 'reversal', quantityDelta: 2, unitCost: 80, reversesMovementId: 'm1' }]);
    expect(f.averageCosts).toEqual([]);
  });

  it('a consumed entry cannot be reversed: INSUFFICIENT_STOCK and nothing written', async () => {
    const f = fakeInventory(fakeState({ documents: [storedEntry()], stock: new Map([[key(PRODUCT_A), 4]]) }));
    await expect(new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal)).rejects.toBeInstanceOf(InsufficientStock);
    expect(f.ledger.insertMovements).not.toHaveBeenCalled();
  });

  it('works on archived locations and products (a correction, like an adjustment)', async () => {
    const f = fakeInventory(fakeState({ documents: [storedEntry()], locations: [{ id: LOC_1, archivedAt: NOW }], products: [activeProduct(PRODUCT_A, 'CUP', true)] }));
    await expect(new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal)).resolves.toBeDefined();
  });

  it('404 for a document that does not exist in the tenant', async () => {
    const f = fakeInventory(fakeState());
    await expect(new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal)).rejects.toBeInstanceOf(ResourceNotFound);
    expect(f.ledger.insertDocumentHeader).not.toHaveBeenCalled();
  });

  it("needs the original's permission in every location it touched, before writing", async () => {
    const writerL1 = actorWith([{ role: custom('w', 'inventory:write'), scope: at(LOC_1) }]);
    const transferL1 = actorWith([{ role: custom('t', 'inventory:transfer'), scope: at(LOC_1) }]);
    const transferBoth = actorWith([{ role: custom('t', 'inventory:transfer'), scope: at(LOC_1, LOC_2) }]);
    const cases: [ReturnType<typeof owner>, StoredDocument, boolean][] = [
      [writerL1, storedEntry(), true],
      [transferL1, storedEntry(), false],
      [writerL1, storedTransfer(), false],
      [transferL1, storedTransfer(), false],
      [transferBoth, storedTransfer(), true],
    ];
    for (const [actor, original, allowed] of cases) {
      const f = fakeInventory(fakeState({ documents: [original], locations: bothLocations, stock: new Map([[key(PRODUCT_A, LOC_1), 20], [key(PRODUCT_A, LOC_2), 20]]) }));
      const run = new ReverseDocument(f.uow, clock).execute({ actor, ip: null }, ORIGINAL_ID, reversal);
      if (allowed) await expect(run).resolves.toBeDefined();
      else {
        await expect(run).rejects.toBeInstanceOf(PermissionDenied);
        expect(f.ledger.insertDocumentHeader).not.toHaveBeenCalled();
      }
    }
  });

  it('a reversal cannot be reversed: ALREADY_REVERSED, once the actor can see it', async () => {
    const reversed = stored({ kind: 'reversal', reversesDocumentId: 'x', movements: [movement({ id: 'm9', locationId: LOC_1, kind: 'reversal', quantityDelta: -1, unitCost: 1 })] });
    const f = fakeInventory(fakeState({ documents: [reversed] }));
    await expect(new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal)).rejects.toBeInstanceOf(AlreadyReversed);
    const stranger = actorWith([{ role: MANAGER_ROLE, scope: at(LOC_2) }]);
    await expect(new ReverseDocument(f.uow, clock).execute({ actor: stranger, ip: null }, ORIGINAL_ID, reversal)).rejects.toBeInstanceOf(PermissionDenied);
    expect(f.ledger.insertDocumentHeader).not.toHaveBeenCalled();
  });

  it('a skipped header with a committed reversal under another id is ALREADY_REVERSED, not an idempotency conflict', async () => {
    const f = fakeInventory(fakeState({ documents: [storedEntry()], inserted: false, reversalOf: 'other-reversal' }));
    await expect(new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal)).rejects.toBeInstanceOf(AlreadyReversed);
    expect(f.ledger.findReversalOf).toHaveBeenCalledWith(ORIGINAL_ID);
    expect(f.ledger.insertMovements).not.toHaveBeenCalled();
  });

  it('a skipped header without any reversal is an id of another tenant: IDEMPOTENCY_CONFLICT', async () => {
    const f = fakeInventory(fakeState({ documents: [storedEntry()], inserted: false }));
    await expect(new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal)).rejects.toBeInstanceOf(IdempotencyConflict);
  });

  it('a retry of the same reversal returns it (200); the same id reversing another document conflicts', async () => {
    const hash = payloadHash('reversal', { documentId: ORIGINAL_ID, ...reversal });
    const existing = stored({ id: DOC_ID, kind: 'reversal', reversesDocumentId: ORIGINAL_ID, payloadHash: hash, movements: [] });
    const retry = fakeInventory(fakeState({ documents: [storedEntry(), existing], inserted: false }));
    await expect(new ReverseDocument(retry.uow, clock).execute(request, ORIGINAL_ID, reversal)).resolves.toMatchObject({ created: false, document: { id: DOC_ID } });

    const other = stored({ id: 'other-original', kind: 'entry', movements: storedEntry().movements });
    const reused = fakeInventory(fakeState({ documents: [other, existing], inserted: false }));
    await expect(new ReverseDocument(reused.uow, clock).execute(request, 'other-original', reversal)).rejects.toBeInstanceOf(IdempotencyConflict);
  });

  it('the replayed average equals the domain replay of the pair ledger with the reversal appended', async () => {
    const ledger = [
      { documentId: 'a', kind: 'entry' as const, quantityDelta: 10, unitCost: 100, reversesDocumentId: null },
      { documentId: ORIGINAL_ID, kind: 'entry' as const, quantityDelta: 10, unitCost: 300, reversesDocumentId: null },
      { documentId: 'b', kind: 'entry' as const, quantityDelta: 5, unitCost: 160, reversesDocumentId: null },
    ];
    const original = stored({ kind: 'entry', movements: [movement({ id: 'm1', locationId: LOC_1, kind: 'entry', quantityDelta: 10, unitCost: 300 })] });
    const f = fakeInventory(fakeState({ documents: [original], stock: new Map([[key(PRODUCT_A), 25]]), ledgers: new Map([[key(PRODUCT_A), ledger]]) }));
    await new ReverseDocument(f.uow, clock).execute(request, ORIGINAL_ID, reversal);
    const expected = replayAverageCost([...ledger, { documentId: DOC_ID, kind: 'reversal', quantityDelta: -10, unitCost: 300, reversesDocumentId: ORIGINAL_ID }]);
    expect(f.averageCosts).toEqual([{ pair: { locationId: LOC_1, productId: PRODUCT_A }, averageCost: expected }]);
    expect(expected).toBe(120);
  });
});
