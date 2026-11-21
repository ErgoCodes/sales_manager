import type { ExitReason, InventoryDocumentKind, InventoryMovementKind, Money } from '@monaco/contracts';

import type { AuditLog } from '../../iam/domain/auth-ports';

/** A (location, product) pair: the unit of stock and of locking (ADR 0006 §3). */
export interface PairKey {
  readonly locationId: string;
  readonly productId: string;
}

export const pairKey = (pair: PairKey): string => `${pair.locationId}:${pair.productId}`;

/** The global lock order of ADR 0006: `(location_id, product_id)`, ascending. */
export function sortPairs(pairs: readonly PairKey[]): PairKey[] {
  return [...pairs].sort((a, b) => (a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

type Currency = Money['currency'];

export interface NewDocumentHeader {
  readonly id: string;
  readonly kind: Extract<InventoryDocumentKind, 'entry' | 'exit' | 'adjustment'>;
  readonly locationId: string;
  readonly reason: ExitReason | null;
  readonly occurredAt: Date;
  readonly notes: string | null;
  /** SHA-256 of the body as the client sent it. */
  readonly payloadHash: string;
  readonly createdBy: string;
}

export interface StoredMovement {
  readonly id: string;
  readonly documentId: string;
  readonly locationId: string;
  readonly productId: string;
  readonly kind: InventoryMovementKind;
  readonly quantityDelta: number;
  /** Minor units, may carry a fraction of a cent. */
  readonly unitCost: number;
  /** Currency of the product (all of its amounts share it). */
  readonly currency: Currency;
  readonly reversesMovementId: string | null;
  readonly createdAt: Date;
}

export interface StoredDocument {
  readonly id: string;
  readonly kind: InventoryDocumentKind;
  readonly locationId: string;
  readonly targetLocationId: string | null;
  readonly reason: ExitReason | null;
  readonly reversesDocumentId: string | null;
  readonly occurredAt: Date;
  readonly notes: string | null;
  readonly payloadHash: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly movements: readonly StoredMovement[];
}

export interface ProductState {
  readonly id: string;
  readonly currency: Currency;
  readonly archivedAt: Date | null;
}

export interface LocationState {
  readonly id: string;
  readonly archivedAt: Date | null;
}

export interface LockedPair extends PairKey {
  /** Average cost projection in minor units. */
  readonly averageCost: number;
}

export interface NewMovement extends PairKey {
  readonly kind: InventoryMovementKind;
  readonly quantityDelta: number;
  readonly unitCost: number;
}

/**
 * The explicit steps of the ADR 0006 script, one method each, so a use case
 * (and its unit test) states the order: header, share-lock the parents, lazy
 * ordered creation and `FOR UPDATE` of the pairs, sum, write.
 */
export interface InventoryLedger {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING` without a target, so every unique index arbitrates:
   * false when the id already exists (also in another tenant). A reversal must not reuse it,
   * or a `(tenant_id, reverses_document_id)` conflict would look like an idempotency replay.
   */
  insertDocumentHeader(header: NewDocumentHeader): Promise<boolean>;
  /** The document with its movements, or null when missing or of another tenant (RLS). */
  findDocument(id: string): Promise<StoredDocument | null>;
  /** `FOR SHARE`, ascending id: a concurrent archive waits for the document or makes it wait. Missing ids are absent. */
  lockLocations(ids: readonly string[]): Promise<LocationState[]>;
  lockProducts(ids: readonly string[]): Promise<ProductState[]>;
  /** `INSERT ... ON CONFLICT DO NOTHING` in the order given (callers pass them sorted). */
  ensureLocationProducts(pairs: readonly PairKey[]): Promise<void>;
  /** `FOR UPDATE` in `(location_id, product_id)` order. */
  lockLocationProducts(pairs: readonly PairKey[]): Promise<LockedPair[]>;
  /** `SUM(quantity_delta)` per pair; pairs without movements are absent (stock 0). Call it after the lock. */
  sumStock(pairs: readonly PairKey[]): Promise<ReadonlyMap<string, number>>;
  insertMovements(documentId: string, movements: readonly NewMovement[]): Promise<void>;
  setAverageCost(pair: PairKey, averageCost: number): Promise<void>;
}

export interface InventoryScope {
  readonly ledger: InventoryLedger;
  readonly audit: AuditLog;
}

/** Same contract as `TenantUnitOfWork`, with the inventory ledger. */
export interface InventoryUnitOfWork {
  run<T>(tenantId: string, work: (scope: InventoryScope) => Promise<T>): Promise<T>;
}
