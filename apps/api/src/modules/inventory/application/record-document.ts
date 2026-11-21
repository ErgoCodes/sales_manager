import type { AuditEventType, ExitReason, InventoryDocument, InventoryDocumentKind, InventoryMovementKind, Money } from '@monaco/contracts';
import {
  assertStockNotNegative,
  averageCostAfterEntry,
  averageCostAfterTransferIn,
  InsufficientStockError,
  movementDelta,
  replayAverageCost,
} from '@monaco/domain';

import { type AdminRequest } from '../../iam/application/admin-support';
import { ResourceNotFound } from '../../iam/domain/errors';
import {
  AlreadyReversed,
  ArchivedResource,
  CurrencyMismatch,
  IdempotencyConflict,
  InsufficientStock,
  type StockShortage,
} from '../domain/inventory-errors';
import {
  type InventoryScope,
  type InventoryUnitOfWork,
  type NewMovement,
  type PairKey,
  pairKey,
  sortPairs,
} from '../domain/inventory-ports';
import { ledgerView, toDocument } from './document-mapper';

/**
 * How a line is valued (its `unit_cost`) and what it does to the pair's average cost:
 *  - `paid`: an entry, at what the user paid; blends it in (`averageCostAfterEntry`);
 *  - `average`: exits, adjustments and `transfer_out`, at the pair's average; no blend;
 *  - `transferred`: a `transfer_in`, at the origin pair's average; blends it in (`averageCostAfterTransferIn`);
 *  - `reversed`: a reversal line, at the cancelled movement's cost; `replay` recomputes the
 *    average with `replayAverageCost` once the line is written (the cancelled one blended).
 */
export type LineValuation =
  | { readonly type: 'paid'; readonly cost: Money }
  | { readonly type: 'average' }
  | { readonly type: 'transferred'; readonly fromLocationId: string }
  | { readonly type: 'reversed'; readonly unitCost: number; readonly movementId: string; readonly replay: boolean };

export interface PlannedLine {
  readonly locationId: string;
  readonly productId: string;
  readonly kind: InventoryMovementKind;
  /** Passed as is to `movementDelta`: the domain owns the sign (positive, or signed for adjustments and reversals). */
  readonly quantity: number;
  readonly valuation: LineValuation;
  /** D15: entries and `transfer_in` need an active location and product; the rest can drain archived ones. */
  readonly requiresActive: boolean;
}

/** A validated and authorized command, ready for the ADR 0006 script. */
export interface DocumentPlan {
  readonly id: string;
  readonly kind: InventoryDocumentKind;
  readonly auditType: AuditEventType;
  /** The only location, or the origin of a transfer, or the original's for a reversal. */
  readonly locationId: string;
  readonly targetLocationId: string | null;
  readonly reason: ExitReason | null;
  readonly reversesDocumentId: string | null;
  readonly occurredAt: Date;
  readonly notes: string | null;
  readonly payloadHash: string;
  readonly lines: readonly PlannedLine[];
  /** Locations, line count and reason: never costs (spec "Auditoría"). */
  readonly auditMetadata: Record<string, unknown>;
}

export interface RecordedDocument {
  readonly document: InventoryDocument;
  /** False when the id already existed with the same content (idempotent retry, HTTP 200). */
  readonly created: boolean;
}

/** The script in its own `withTenant` transaction. */
export async function recordDocument(uow: InventoryUnitOfWork, request: AdminRequest, plan: DocumentPlan): Promise<RecordedDocument> {
  return uow.run(request.actor.tenantId, (scope) => writeDocument(scope, request, plan));
}

/**
 * The single script every inventory write follows (ADR 0006, spec "Cómo funciona
 * un documento"). Steps 1 and 2 (validate, authorize) happened in the use case;
 * here, inside the caller's `withTenant` transaction:
 *
 *   3. idempotent header     4. FOR SHARE parents, lazy + FOR UPDATE pairs, sorted
 *   5. sum of the stock      6. domain rules       7. write, project, audit
 *
 * The pairs of every location the document touches (both ends of a transfer, every
 * location of a reversed document) are locked together in the one global order.
 * No sign, stock or cost arithmetic lives here: it is `@monaco/domain`.
 */
export async function writeDocument(scope: InventoryScope, { actor, ip }: AdminRequest, plan: DocumentPlan): Promise<RecordedDocument> {
  const inserted = await scope.ledger.insertDocumentHeader({
    id: plan.id,
    kind: plan.kind,
    locationId: plan.locationId,
    targetLocationId: plan.targetLocationId,
    reason: plan.reason,
    reversesDocumentId: plan.reversesDocumentId,
    occurredAt: plan.occurredAt,
    notes: plan.notes,
    payloadHash: plan.payloadHash,
    createdBy: actor.userId,
  });
  if (!inserted) return replay(scope, plan, actor);

  await lockParents(scope, plan);
  const unique = new Map(plan.lines.map((line) => [pairKey(line), { locationId: line.locationId, productId: line.productId }]));
  const pairs = sortPairs([...unique.values()]);
  await scope.ledger.ensureLocationProducts(pairs);
  const locked = await scope.ledger.lockLocationProducts(pairs);
  const averageCost = new Map(locked.map((pair) => [pairKey(pair), pair.averageCost]));
  // After the lock: nobody else can change these sums until we commit.
  const stock = await scope.ledger.sumStock(pairs);

  const { movements, projections, replays, shortages } = compute(plan, stock, averageCost);
  if (shortages.length > 0) throw new InsufficientStock(shortages);

  await scope.ledger.insertMovements(plan.id, movements);
  for (const projection of projections) await scope.ledger.setAverageCost(projection.pair, projection.averageCost);
  // A reversal of a blending line: the pair's cost is the replay of its ledger without the reversed document.
  for (const pair of replays) await scope.ledger.setAverageCost(pair, replayAverageCost(await scope.ledger.pairLedger(pair)));
  await scope.audit.record({
    type: plan.auditType,
    actorUserId: actor.userId,
    targetType: 'inventory_document',
    targetId: plan.id,
    metadata: plan.auditMetadata,
    ip,
  });
  const stored = await scope.ledger.findDocument(plan.id);
  /* v8 ignore next -- the header was inserted in this transaction */
  if (!stored) throw new Error('Inventory document disappeared inside its own transaction');
  return { document: toDocument(stored, ledgerView(actor.effective)), created: true };
}

/**
 * The header insert was skipped. The id exists: the document (same hash) or a conflict
 * (other content). The id does not exist (in this tenant): for a reversal, the original may
 * have been reversed under another id (ALREADY_REVERSED); otherwise the id is another tenant's.
 */
async function replay(scope: InventoryScope, plan: DocumentPlan, actor: AdminRequest['actor']): Promise<RecordedDocument> {
  const existing = await scope.ledger.findDocument(plan.id);
  if (existing) {
    if (existing.payloadHash !== plan.payloadHash) throw new IdempotencyConflict();
    return { document: toDocument(existing, ledgerView(actor.effective)), created: false };
  }
  if (plan.reversesDocumentId !== null && (await scope.ledger.findReversalOf(plan.reversesDocumentId)) !== null) throw new AlreadyReversed();
  throw new IdempotencyConflict();
}

/** `FOR SHARE` on the locations and the products: a concurrent archive serializes with this document. */
async function lockParents(scope: InventoryScope, plan: DocumentPlan): Promise<void> {
  const locationIds = [...new Set(plan.lines.map((line) => line.locationId))];
  const locations = new Map((await scope.ledger.lockLocations(locationIds)).map((location) => [location.id, location]));
  for (const id of locationIds) {
    const location = locations.get(id);
    if (!location) throw new ResourceNotFound('location');
    const needsActive = plan.lines.some((line) => line.locationId === id && line.requiresActive);
    if (needsActive && location.archivedAt !== null) throw new ArchivedResource('location');
  }

  const productIds = [...new Set(plan.lines.map((line) => line.productId))];
  const products = new Map((await scope.ledger.lockProducts(productIds)).map((product) => [product.id, product]));
  for (const line of plan.lines) {
    const product = products.get(line.productId);
    if (!product) throw new ResourceNotFound('product');
    if (line.requiresActive && product.archivedAt !== null) throw new ArchivedResource('product');
    if (line.valuation.type === 'paid' && line.valuation.cost.currency !== product.currency) throw new CurrencyMismatch(product.id);
  }
}

function compute(plan: DocumentPlan, stock: ReadonlyMap<string, number>, averageCost: ReadonlyMap<string, number>) {
  const movements: NewMovement[] = [];
  const projections: { pair: PairKey; averageCost: number }[] = [];
  const replays: PairKey[] = [];
  const shortages: StockShortage[] = [];
  const running = new Map(stock);
  for (const line of plan.lines) {
    const pair = { locationId: line.locationId, productId: line.productId };
    const currentStock = running.get(pairKey(pair)) ?? 0;
    const currentAverage = averageCost.get(pairKey(pair)) ?? 0;
    const delta = movementDelta(line.kind, line.quantity);
    try {
      running.set(pairKey(pair), assertStockNotNegative(currentStock, [delta]));
    } catch (error) {
      if (!(error instanceof InsufficientStockError)) throw error;
      shortages.push({ productId: line.productId, available: error.available, shortBy: error.shortBy });
      continue;
    }
    const valuation = line.valuation;
    const movement = { ...pair, kind: line.kind, quantityDelta: delta };
    switch (valuation.type) {
      case 'paid':
        movements.push({ ...movement, unitCost: valuation.cost.amount });
        projections.push({ pair, averageCost: averageCostAfterEntry(currentStock, currentAverage, delta, valuation.cost.amount) });
        break;
      case 'average':
        movements.push({ ...movement, unitCost: currentAverage });
        break;
      case 'transferred': {
        // `transfer_out` does not move the origin's average: its locked value is the cost that travels.
        const sourceAverage = averageCost.get(pairKey({ locationId: valuation.fromLocationId, productId: line.productId })) ?? 0;
        movements.push({ ...movement, unitCost: sourceAverage });
        projections.push({ pair, averageCost: averageCostAfterTransferIn(currentStock, currentAverage, delta, sourceAverage) });
        break;
      }
      case 'reversed':
        movements.push({ ...movement, unitCost: valuation.unitCost, reversesMovementId: valuation.movementId });
        if (valuation.replay) replays.push(pair);
        break;
    }
  }
  return { movements, projections, replays, shortages };
}
