import type { CreateAdjustmentRequest, CreateEntryRequest, CreateExitRequest } from '@monaco/contracts';

import type { AdminRequest } from '../../iam/application/admin-support';
import type { Clock } from '../../iam/domain/auth-ports';
import { authorize } from '../../iam/domain/permissions';
import { FutureOccurredAt } from '../domain/inventory-errors';
import type { InventoryUnitOfWork } from '../domain/inventory-ports';
import { payloadHash } from './payload-hash';
import { type DocumentPlan, type RecordedDocument, recordDocument } from './record-document';

/** Tolerated client clock skew for `occurredAt` (D13: it cannot be in the future). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Steps 1 and 2 of the script that are common to every write: authority in the
 * document's location (before any data is touched) and the business date.
 * The hash covers the body before the `occurredAt` default is applied.
 */
function begin(
  { actor }: AdminRequest,
  clock: Clock,
  kind: DocumentPlan['kind'],
  body: { id: string; locationId: string; occurredAt?: string; notes?: string },
): Pick<DocumentPlan, 'id' | 'locationId' | 'occurredAt' | 'notes' | 'payloadHash'> {
  authorize(actor, 'inventory:write', body.locationId);
  const now = clock.now();
  const occurredAt = body.occurredAt === undefined ? now : new Date(body.occurredAt);
  if (occurredAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new FutureOccurredAt();
  return { id: body.id, locationId: body.locationId, occurredAt, notes: body.notes ?? null, payloadHash: payloadHash(kind, body) };
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
      requiresActive: true,
      lines: body.lines.map((line) => ({ productId: line.productId, kind: 'entry', quantity: line.quantity, unitCost: line.unitCost })),
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
      requiresActive: false,
      lines: body.lines.map((line) => ({ productId: line.productId, kind: body.reason, quantity: line.quantity, unitCost: null })),
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
      requiresActive: false,
      lines: body.lines.map((line) => ({ productId: line.productId, kind: 'adjustment', quantity: line.quantityDelta, unitCost: null })),
    });
  }
}
