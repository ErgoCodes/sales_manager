import type {
  CreateAdjustmentRequest,
  CreateEntryRequest,
  CreateExitRequest,
  CreateReversalRequest,
  CreateTransferRequest,
  Permission,
} from '@monaco/contracts';
import { blendsAverageCost } from '@monaco/domain';

import type { AdminRequest } from '../../iam/application/admin-support';
import type { Clock } from '../../iam/domain/auth-ports';
import { ResourceNotFound } from '../../iam/domain/errors';
import { authorize, authorizeRead } from '../../iam/domain/permissions';
import { AlreadyReversed, FutureOccurredAt } from '../domain/inventory-errors';
import type { InventoryUnitOfWork, StoredDocument } from '../domain/inventory-ports';
import { documentLocations } from './document-mapper';
import { payloadHash } from './payload-hash';
import { type DocumentPlan, type RecordedDocument, recordDocument, writeDocument } from './record-document';

/** Tolerated client clock skew for `occurredAt` (D13: it cannot be in the future). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** The business date (D13): now by default, never in the future. */
export function businessDate(clock: Clock, occurredAt: string | undefined): Date {
  const now = clock.now();
  const date = occurredAt === undefined ? now : new Date(occurredAt);
  if (date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new FutureOccurredAt();
  return date;
}

/**
 * Steps 1 and 2 of the script for a single-location write: authority in the
 * document's location (before any data is touched) and the business date.
 * The hash covers the body before the `occurredAt` default is applied.
 */
function begin(
  { actor }: AdminRequest,
  clock: Clock,
  kind: 'entry' | 'exit' | 'adjustment',
  body: { id: string; locationId: string; occurredAt?: string; notes?: string },
): Pick<DocumentPlan, 'id' | 'locationId' | 'targetLocationId' | 'reversesDocumentId' | 'occurredAt' | 'notes' | 'payloadHash'> {
  authorize(actor, 'inventory:write', body.locationId);
  return {
    id: body.id,
    locationId: body.locationId,
    targetLocationId: null,
    reversesDocumentId: null,
    occurredAt: businessDate(clock, body.occurredAt),
    notes: body.notes ?? null,
    payloadHash: payloadHash(kind, body),
  };
}

/** POST /inventory/entries (`inventory:write` in the location). Mixes the average cost per line. */
export class RecordEntry {
  constructor(
    private readonly uow: InventoryUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, body: CreateEntryRequest): Promise<RecordedDocument> {
    const head = begin(request, this.clock, 'entry', body);
    return recordDocument(this.uow, request, {
      ...head,
      kind: 'entry',
      auditType: 'inventory_entry_recorded',
      reason: null,
      auditMetadata: { locationId: body.locationId, lineCount: body.lines.length },
      lines: body.lines.map((line) => ({
        locationId: body.locationId,
        productId: line.productId,
        kind: 'entry',
        quantity: line.quantity,
        valuation: { type: 'paid', cost: line.unitCost },
        requiresActive: true,
      })),
    });
  }
}

/** POST /inventory/exits: shrinkage or owner withdrawal. An archived location or product can be drained (D15). */
export class RecordExit {
  constructor(
    private readonly uow: InventoryUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, body: CreateExitRequest): Promise<RecordedDocument> {
    const head = begin(request, this.clock, 'exit', body);
    return recordDocument(this.uow, request, {
      ...head,
      kind: 'exit',
      auditType: 'inventory_exit_recorded',
      reason: body.reason,
      auditMetadata: { locationId: body.locationId, lineCount: body.lines.length, reason: body.reason },
      lines: body.lines.map((line) => ({
        locationId: body.locationId,
        productId: line.productId,
        kind: body.reason,
        quantity: line.quantity,
        valuation: { type: 'average' },
        requiresActive: false,
      })),
    });
  }
}

/** POST /inventory/adjustments: signed deltas; a decrease obeys the same non-negative rule. */
export class RecordAdjustment {
  constructor(
    private readonly uow: InventoryUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, body: CreateAdjustmentRequest): Promise<RecordedDocument> {
    const head = begin(request, this.clock, 'adjustment', body);
    return recordDocument(this.uow, request, {
      ...head,
      kind: 'adjustment',
      auditType: 'inventory_adjustment_recorded',
      reason: null,
      auditMetadata: { locationId: body.locationId, lineCount: body.lines.length },
      lines: body.lines.map((line) => ({
        locationId: body.locationId,
        productId: line.productId,
        kind: 'adjustment',
        quantity: line.quantityDelta,
        valuation: { type: 'average' },
        requiresActive: false,
      })),
    });
  }
}

/**
 * POST /inventory/transfers (D6, D7): one atomic document with a `transfer_out` in the
 * origin and a `transfer_in` in the destination per line, `inventory:transfer` in both.
 * The destination blends in the origin's average cost. An archived origin can be drained;
 * an archived destination, or an archived product, gives ARCHIVED (D15).
 */
export class RecordTransfer {
  constructor(
    private readonly uow: InventoryUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, body: CreateTransferRequest): Promise<RecordedDocument> {
    const { fromLocationId, toLocationId } = body;
    authorize(request.actor, 'inventory:transfer', fromLocationId);
    authorize(request.actor, 'inventory:transfer', toLocationId);
    return recordDocument(this.uow, request, {
      id: body.id,
      kind: 'transfer',
      auditType: 'inventory_transfer_recorded',
      locationId: fromLocationId,
      targetLocationId: toLocationId,
      reason: null,
      reversesDocumentId: null,
      occurredAt: businessDate(this.clock, body.occurredAt),
      notes: body.notes ?? null,
      payloadHash: payloadHash('transfer', body),
      auditMetadata: { fromLocationId, toLocationId, lineCount: body.lines.length },
      lines: body.lines.flatMap((line) => [
        { locationId: fromLocationId, productId: line.productId, kind: 'transfer_out', quantity: line.quantity, valuation: { type: 'average' }, requiresActive: false },
        {
          locationId: toLocationId,
          productId: line.productId,
          kind: 'transfer_in',
          quantity: line.quantity,
          valuation: { type: 'transferred', fromLocationId },
          requiresActive: true,
        },
      ]),
    });
  }
}

/** The permission each location of a document needed: the one a reversal needs there too. */
function permissionsOf(original: StoredDocument): [Permission, string][] {
  if (original.kind === 'transfer' && original.targetLocationId !== null) {
    return [
      ['inventory:transfer', original.locationId],
      ['inventory:transfer', original.targetLocationId],
    ];
  }
  return [['inventory:write', original.locationId]];
}

/**
 * POST /inventory/documents/:id/reversal (D8): a `reversal` document with the exact
 * opposite of every movement of the original, in every location it touched, at the
 * cost each movement had. The original's permission is needed in each of those
 * locations. At most once per document (ALREADY_REVERSED, also for a concurrent
 * reversal with another id); a reversal itself cannot be reversed. It obeys the
 * non-negative stock rule, and a reversed entry or `transfer_in` recomputes that
 * pair's average cost with `replayAverageCost` (the origin of a transfer keeps its own).
 * Reversals pass on archived locations and products, like adjustments (they correct, D15).
 */
export class ReverseDocument {
  constructor(
    private readonly uow: InventoryUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, documentId: string, body: CreateReversalRequest): Promise<RecordedDocument> {
    const { actor } = request;
    const occurredAt = this.clock.now();
    return this.uow.run(actor.tenantId, async (scope) => {
      // The original decides which locations and permission apply; another tenant's id finds nothing (RLS).
      const original = await scope.ledger.findDocument(documentId);
      if (!original) throw new ResourceNotFound('inventory_document');
      if (original.kind === 'reversal') {
        // Reading the document already tells it is a reversal: viewing it is enough to learn it cannot be reversed.
        for (const locationId of documentLocations(original)) authorizeRead(actor, 'inventory:view', locationId);
        throw new AlreadyReversed();
      }
      for (const [permission, locationId] of permissionsOf(original)) authorize(actor, permission, locationId);

      return writeDocument(scope, request, {
        id: body.id,
        kind: 'reversal',
        auditType: 'inventory_document_reversed',
        locationId: original.locationId,
        targetLocationId: null,
        reason: null,
        reversesDocumentId: original.id,
        occurredAt,
        notes: body.notes ?? null,
        // The reversed document is part of the content: the same id cannot reverse another one.
        payloadHash: payloadHash('reversal', { documentId: original.id, ...body }),
        auditMetadata: { reversesDocumentId: original.id, locationIds: documentLocations(original), lineCount: original.movements.length },
        lines: original.movements.map((movement) => ({
          locationId: movement.locationId,
          productId: movement.productId,
          kind: 'reversal',
          // The exact opposite: `movementDelta('reversal', q)` keeps the sign it is given.
          quantity: -movement.quantityDelta,
          valuation: { type: 'reversed', unitCost: movement.unitCost, movementId: movement.id, replay: blendsAverageCost(movement.kind) },
          requiresActive: false,
        })),
      });
    });
  }
}
