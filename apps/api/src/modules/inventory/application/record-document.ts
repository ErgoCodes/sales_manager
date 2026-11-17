import type { AuditEventType, ExitReason, InventoryDocument, InventoryMovementKind, Money } from '@monaco/contracts';
import {
  assertStockNotNegative,
  averageCostAfterEntry,
  InsufficientStockError,
  movementDelta,
} from '@monaco/domain';

import { type AdminRequest } from '../../iam/application/admin-support';
import { ResourceNotFound } from '../../iam/domain/errors';
import {
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
import { toDocument } from './document-mapper';

export interface PlannedLine {
  readonly productId: string;
  readonly kind: InventoryMovementKind;
  /** Passed as is to `movementDelta`: the domain owns the sign (positive, or signed for adjustments). */
  readonly quantity: number;
  /** Entries only: the cost the user paid per unit. */
  readonly unitCost: Money | null;
}

/** A validated and authorized command, ready for the ADR 0006 script. */
export interface DocumentPlan {
  readonly id: string;
  readonly kind: 'entry' | 'exit' | 'adjustment';
  readonly auditType: AuditEventType;
  readonly locationId: string;
  readonly reason: ExitReason | null;
  readonly occurredAt: Date;
  readonly notes: string | null;
  readonly payloadHash: string;
  readonly lines: readonly PlannedLine[];
  /** Entries need an active location and product (D15); exits and adjustments can drain archived ones. */
  readonly requiresActive: boolean;
}

export interface RecordedDocument {
  readonly document: InventoryDocument;
  /** False when the id already existed with the same content (idempotent retry, HTTP 200). */
  readonly created: boolean;
}

/**
 * The single script every inventory write follows (ADR 0006, spec "Cómo funciona
 * un documento"). Steps 1 and 2 (validate, authorize) happened in the use case;
 * here, inside one `withTenant` transaction:
 *
 *   3. idempotent header     4. FOR SHARE parents, lazy + FOR UPDATE pairs, sorted
 *   5. sum of the stock      6. domain rules       7. write, project, audit
 *
 * No sign, stock or cost arithmetic lives here: it is `@monaco/domain`.
 */
export async function recordDocument(uow: InventoryUnitOfWork, { actor, ip }: AdminRequest, plan: DocumentPlan): Promise<RecordedDocument> {
  return uow.run(actor.tenantId, async (scope) => {
    const inserted = await scope.ledger.insertDocumentHeader({
      id: plan.id,
      kind: plan.kind,
      locationId: plan.locationId,
      reason: plan.reason,
      occurredAt: plan.occurredAt,
      notes: plan.notes,
      payloadHash: plan.payloadHash,
      createdBy: actor.userId,
    });
    if (!inserted) return replay(scope, plan);

    await lockParents(scope, plan);
    const pairs = sortPairs(plan.lines.map((line) => ({ locationId: plan.locationId, productId: line.productId })));
    await scope.ledger.ensureLocationProducts(pairs);
    const locked = await scope.ledger.lockLocationProducts(pairs);
    const averageCost = new Map(locked.map((pair) => [pairKey(pair), pair.averageCost]));
    // After the lock: nobody else can change these sums until we commit.
    const stock = await scope.ledger.sumStock(pairs);

    const { movements, projections, shortages } = compute(plan, stock, averageCost);
    if (shortages.length > 0) throw new InsufficientStock(shortages);

    await scope.ledger.insertMovements(plan.id, movements);
    for (const projection of projections) await scope.ledger.setAverageCost(projection.pair, projection.averageCost);
    await scope.audit.record({
      type: plan.auditType,
      actorUserId: actor.userId,
      targetType: 'inventory_document',
      targetId: plan.id,
      metadata: { locationId: plan.locationId, lineCount: plan.lines.length, ...(plan.reason ? { reason: plan.reason } : {}) },
      ip,
    });
    const stored = await scope.ledger.findDocument(plan.id);
    /* v8 ignore next -- the header was inserted in this transaction */
    if (!stored) throw new Error('Inventory document disappeared inside its own transaction');
    return { document: toDocument(stored), created: true };
  });
}

/** The header insert found the id: the document (same hash) or a conflict (other content, or another tenant's id). */
async function replay(scope: InventoryScope, plan: DocumentPlan): Promise<RecordedDocument> {
  const existing = await scope.ledger.findDocument(plan.id);
  if (!existing || existing.payloadHash !== plan.payloadHash) throw new IdempotencyConflict();
  return { document: toDocument(existing), created: false };
}

/** `FOR SHARE` on the location and the products: a concurrent archive serializes with this document. */
async function lockParents(scope: InventoryScope, plan: DocumentPlan): Promise<void> {
  const [location] = await scope.ledger.lockLocations([plan.locationId]);
  if (!location) throw new ResourceNotFound('location');
  if (plan.requiresActive && location.archivedAt !== null) throw new ArchivedResource('location');

  const productIds = plan.lines.map((line) => line.productId);
  const products = new Map((await scope.ledger.lockProducts(productIds)).map((product) => [product.id, product]));
  for (const line of plan.lines) {
    const product = products.get(line.productId);
    if (!product) throw new ResourceNotFound('product');
    if (plan.requiresActive && product.archivedAt !== null) throw new ArchivedResource('product');
    if (line.unitCost && line.unitCost.currency !== product.currency) throw new CurrencyMismatch(product.id);
  }
}

function compute(plan: DocumentPlan, stock: ReadonlyMap<string, number>, averageCost: ReadonlyMap<string, number>) {
  const movements: NewMovement[] = [];
  const projections: { pair: PairKey; averageCost: number }[] = [];
  const shortages: StockShortage[] = [];
  for (const line of plan.lines) {
    const pair = { locationId: plan.locationId, productId: line.productId };
    const currentStock = stock.get(pairKey(pair)) ?? 0;
    const currentAverage = averageCost.get(pairKey(pair)) ?? 0;
    const delta = movementDelta(line.kind, line.quantity);
    try {
      assertStockNotNegative(currentStock, [delta]);
    } catch (error) {
      if (!(error instanceof InsufficientStockError)) throw error;
      shortages.push({ productId: line.productId, available: error.available, shortBy: error.shortBy });
      continue;
    }
    // Entries are valued at what was paid; every other kind at the pair's average cost (D4).
    movements.push({ ...pair, kind: line.kind, quantityDelta: delta, unitCost: line.unitCost?.amount ?? currentAverage });
    if (line.unitCost) {
      projections.push({ pair, averageCost: averageCostAfterEntry(currentStock, currentAverage, delta, line.unitCost.amount) });
    }
  }
  return { movements, projections, shortages };
}
