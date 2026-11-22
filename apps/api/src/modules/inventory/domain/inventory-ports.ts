import type { ExitReason, InventoryDocumentKind, InventoryMovementKind, Money, Paginated } from '@monaco/contracts';
import type { LedgerLine } from '@monaco/domain';

import type { PageRequest } from '../../iam/domain/admin-ports';
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
  readonly kind: InventoryDocumentKind;
  /** The only location, or the origin of a transfer; a reversal keeps the original's. */
  readonly locationId: string;
  /** Destination of a transfer; null for every other kind. */
  readonly targetLocationId: string | null;
  readonly reason: ExitReason | null;
  /** The reversed document; null unless `kind` is `reversal`. */
  readonly reversesDocumentId: string | null;
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
  readonly locationName: string;
  readonly targetLocationId: string | null;
  readonly targetLocationName: string | null;
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
  /** Catalog cost price in minor units, null when unset: the fallback of `effectiveUnitCost` (sales). */
  readonly costPrice: number | null;
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
  /** Reversal lines only: the movement this one cancels. */
  readonly reversesMovementId?: string;
}

/**
 * The explicit steps of the ADR 0006 script, one method each, so a use case
 * (and its unit test) states the order: header, share-lock the parents, lazy
 * ordered creation and `FOR UPDATE` of the pairs, sum, write.
 */
export interface InventoryLedger {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING` without a target, so every unique index arbitrates
   * (and waits for a concurrent insert of the same key): false when the id already exists
   * (also in another tenant) *or*, for a reversal, when the document is already reversed
   * (`UNIQUE (tenant_id, reverses_document_id)`). A false alone is ambiguous: the caller
   * tells the cases apart with `findDocument(id)` and then `findReversalOf`, never by
   * assuming an idempotent replay (that would turn ALREADY_REVERSED into IDEMPOTENCY_CONFLICT).
   */
  insertDocumentHeader(header: NewDocumentHeader): Promise<boolean>;
  /** Id of the committed reversal of `documentId`, or null when it was never reversed. */
  findReversalOf(documentId: string): Promise<string | null>;
  /**
   * The ledger of one pair in insertion order (`created_at`, `id`), each line with the
   * document it reverses (if any): the input of `replayAverageCost`. Call it after the lock.
   */
  pairLedger(pair: PairKey): Promise<LedgerLine[]>;
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

/** One product's stock at one location. Amounts in minor units of the product's currency. */
export interface StockRecord {
  readonly productId: string;
  readonly name: string;
  readonly unitOfMeasure: string;
  readonly category: string | null;
  readonly currency: Currency;
  /** The product's own threshold; the effective one comes from `getProductThreshold`. */
  readonly lowStockThreshold: number | null;
  readonly archivedAt: Date | null;
  readonly quantity: number;
  readonly averageCost: number;
}

/** One location's stock of a product. */
export interface LocationStockRecord {
  readonly locationId: string;
  readonly locationName: string;
  readonly currency: Currency;
  readonly quantity: number;
  readonly averageCost: number;
}

/** A movement of the location's ledger, with the other location of its transfer (if any). */
export interface MovementRecord extends StoredMovement {
  readonly counterpartLocationId: string | null;
  readonly counterpartLocationName: string | null;
}

export interface MovementFilter {
  readonly productId?: string;
  readonly kind?: InventoryMovementKind;
  readonly from?: Date;
  readonly to?: Date;
}

/** Read side of the ledger, on the current tenant (RLS): another tenant's ids find nothing. */
export interface InventoryReader {
  locationExists(id: string): Promise<boolean>;
  productExists(id: string): Promise<boolean>;
  /**
   * Products of the location by `(name, id)`: active ones, plus archived ones that still
   * hold stock there. `keep` filters rows (e.g. low stock) without breaking the pagination.
   */
  listStock(locationId: string, page: PageRequest & { readonly q?: string }, keep?: (record: StockRecord) => boolean): Promise<Paginated<StockRecord>>;
  /** Every location (active, or archived with stock) with its stock of the product, by name. */
  productStock(productId: string): Promise<LocationStockRecord[]>;
  /** The location's movements, newest first: `(created_at, id)` descending. */
  listMovements(locationId: string, page: PageRequest & MovementFilter): Promise<Paginated<MovementRecord>>;
}

export interface InventoryScope {
  readonly ledger: InventoryLedger;
  readonly reader: InventoryReader;
  readonly audit: AuditLog;
}

/** Same contract as `TenantUnitOfWork`, with the inventory ledger. */
export interface InventoryUnitOfWork {
  run<T>(tenantId: string, work: (scope: InventoryScope) => Promise<T>): Promise<T>;
}
