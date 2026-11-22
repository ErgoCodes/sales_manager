import type { LedgerLine } from '@monaco/domain';
import { vi } from 'vitest';

import { LOC_1, TENANT } from '../../../iam/application/__tests__/admin-fakes';
import type {
  InventoryLedger,
  InventoryReader,
  InventoryScope,
  InventoryUnitOfWork,
  LocationState,
  LockedPair,
  PairKey,
  ProductState,
  StoredDocument,
  StoredMovement,
} from '../../domain/inventory-ports';
import { pairKey } from '../../domain/inventory-ports';

export const PRODUCT_A = '0190a000-0000-7000-8000-0000000000d1';
export const PRODUCT_B = '0190a000-0000-7000-8000-0000000000d2';
export const DOC_ID = '0190a000-0000-7000-8000-0000000000e1';
export const CREATED_AT = new Date('2026-11-05T12:00:00.000Z');

export interface FakeState {
  /** False: the id already exists (the retry path). */
  inserted: boolean;
  existing: StoredDocument | null;
  /** Committed documents found by id before `existing` (the original of a reversal). */
  documents: StoredDocument[];
  /** What `findReversalOf` answers: the id of the committed reversal, if any. */
  reversalOf: string | null;
  /** `pairLedger` per pair key, before the lines this document writes. */
  ledgers: Map<string, LedgerLine[]>;
  locations: LocationState[];
  products: ProductState[];
  /** Average cost per pair, minor units. */
  averageCost: Map<string, number>;
  stock: Map<string, number>;
  calls: string[];
}

export const activeProduct = (id: string, currency: 'CUP' | 'USD' | 'MLC' = 'CUP', archived = false, costPrice: number | null = null): ProductState => ({
  id,
  currency,
  costPrice,
  archivedAt: archived ? CREATED_AT : null,
});

export const key = (productId: string, locationId = LOC_1) => pairKey({ locationId, productId });

export function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    inserted: true,
    existing: null,
    documents: [],
    reversalOf: null,
    ledgers: new Map(),
    locations: [{ id: LOC_1, archivedAt: null }],
    products: [activeProduct(PRODUCT_A), activeProduct(PRODUCT_B)],
    averageCost: new Map(),
    stock: new Map([
      [key(PRODUCT_A), 10],
      [key(PRODUCT_B), 10],
    ]),
    calls: [],
    ...overrides,
  };
}

type NewMovementLike = { locationId: string; productId: string; kind: StoredMovement['kind']; quantityDelta: number; unitCost: number };

/**
 * An in-memory ledger that records the order of the calls (the ADR 0006 script)
 * and keeps the movements it was asked to write, so `findDocument` can return them.
 */
export function fakeLedger(state: FakeState) {
  const written: { documentId: string; movements: unknown[] }[] = [];
  const headers: unknown[] = [];
  const averageCosts: { pair: PairKey; averageCost: number }[] = [];
  const ledger: InventoryLedger = {
    insertDocumentHeader: vi.fn(async (header) => {
      state.calls.push('insertDocumentHeader');
      headers.push(header);
      return state.inserted;
    }),
    findDocument: vi.fn(async (id) => {
      state.calls.push('findDocument');
      const committed = state.documents.find((d) => d.id === id);
      if (committed) return committed;
      if (state.existing) return state.existing;
      if (!state.inserted || headers.length === 0) return null;
      const header = headers[0] as Omit<StoredDocument, 'id' | 'locationName' | 'targetLocationName' | 'createdAt' | 'movements'>;
      const movements: StoredMovement[] = (written[0]?.movements ?? []).map((m, index) => {
        const movement = m as { locationId: string; productId: string; kind: StoredMovement['kind']; quantityDelta: number; unitCost: number; reversesMovementId?: string };
        const product = state.products.find((p) => p.id === movement.productId)!;
        return { ...movement, id: `movement-${index}`, documentId: id, currency: product.currency, reversesMovementId: movement.reversesMovementId ?? null, createdAt: CREATED_AT };
      });
      const targetLocationName = header.targetLocationId === null ? null : 'Location 2';
      return { id, ...header, locationName: 'Location 1', targetLocationName, createdAt: CREATED_AT, movements };
    }),
    findReversalOf: vi.fn(async () => {
      state.calls.push('findReversalOf');
      return state.reversalOf;
    }),
    pairLedger: vi.fn(async (pair: PairKey): Promise<LedgerLine[]> => {
      state.calls.push('pairLedger');
      const before = state.ledgers.get(pairKey(pair)) ?? [];
      const header = headers[0] as { id: string; reversesDocumentId: string | null } | undefined;
      const mine = (written[0]?.movements ?? [])
        .map((m) => m as NewMovementLike)
        .filter((m) => m.locationId === pair.locationId && m.productId === pair.productId)
        .map((m) => ({ documentId: header!.id, kind: m.kind, quantityDelta: m.quantityDelta, unitCost: m.unitCost, reversesDocumentId: header!.reversesDocumentId }));
      return [...before, ...mine];
    }),
    lockLocations: vi.fn(async (ids) => {
      state.calls.push('lockLocations');
      return state.locations.filter((l) => ids.includes(l.id));
    }),
    lockProducts: vi.fn(async (ids) => {
      state.calls.push('lockProducts');
      return state.products.filter((p) => ids.includes(p.id));
    }),
    ensureLocationProducts: vi.fn(async () => {
      state.calls.push('ensureLocationProducts');
    }),
    lockLocationProducts: vi.fn(async (pairs: readonly PairKey[]): Promise<LockedPair[]> => {
      state.calls.push('lockLocationProducts');
      return pairs.map((p) => ({ ...p, averageCost: state.averageCost.get(pairKey(p)) ?? 0 }));
    }),
    sumStock: vi.fn(async (pairs: readonly PairKey[]): Promise<ReadonlyMap<string, number>> => {
      state.calls.push('sumStock');
      const found = new Map<string, number>();
      for (const pair of pairs) if (state.stock.has(pairKey(pair))) found.set(pairKey(pair), state.stock.get(pairKey(pair))!);
      return found;
    }),
    insertMovements: vi.fn(async (documentId, movements) => {
      state.calls.push('insertMovements');
      written.push({ documentId, movements: [...movements] });
    }),
    setAverageCost: vi.fn(async (pair, averageCost) => {
      state.calls.push('setAverageCost');
      averageCosts.push({ pair, averageCost });
    }),
  };
  return { ledger, written, headers, averageCosts };
}

/** A reader whose every method is a `vi.fn()`; read tests set the results they need. */
export function fakeReader() {
  return {
    locationExists: vi.fn(async (_id: string) => true),
    productExists: vi.fn(async (_id: string) => true),
    listStock: vi.fn<InventoryReader['listStock']>(async () => ({ items: [], nextCursor: null })),
    productStock: vi.fn<InventoryReader['productStock']>(async () => []),
    listMovements: vi.fn<InventoryReader['listMovements']>(async () => ({ items: [], nextCursor: null })),
  } satisfies InventoryReader;
}

export function fakeInventory(state: FakeState = fakeState(), reader = fakeReader()) {
  const { ledger, written, headers, averageCosts } = fakeLedger(state);
  const audit = {
    record: vi.fn(async () => {
      state.calls.push('audit');
    }),
  };
  const runs: string[] = [];
  const scope: InventoryScope = { ledger, reader, audit };
  const uow: InventoryUnitOfWork = {
    run: async (tenantId, work) => {
      runs.push(tenantId);
      return work(scope);
    },
  };
  return { uow, ledger, reader, audit, state, written, headers, averageCosts, runs, tenant: TENANT };
}
