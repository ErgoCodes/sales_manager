import type { CurrencyCode } from '@monaco/contracts';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../infrastructure/db/database';
import { locationProducts, products } from '../infrastructure/db/schema';
import { withTenant } from '../infrastructure/db/with-tenant';
import { CreateProduct, SetLocationPrice } from '../modules/catalog/application/catalog.use-cases';
import { DrizzleCatalogUnitOfWork } from '../modules/catalog/infrastructure/drizzle-catalog-unit-of-work';
import type { AdminRequest } from '../modules/iam/application/admin-support';
import type { Clock } from '../modules/iam/domain/auth-ports';
import { effectivePermissions } from '../modules/iam/domain/permissions';
import { SYSTEM_ROLES } from '../modules/iam/domain/system-roles';
import { RecordEntry, RecordExit, RecordTransfer } from '../modules/inventory/application/inventory.use-cases';
import { DrizzleInventoryUnitOfWork } from '../modules/inventory/infrastructure/drizzle-inventory-unit-of-work';

const CURRENCY: CurrencyCode = 'CUP';
const cup = (amount: number) => ({ amount, currency: CURRENCY });

/** Demo catalog. Amounts in minor units (CUP cents). Products are found again by name on a re-run. */
export const DEMO_PRODUCTS = [
  { key: 'rice', name: 'Arroz', unitOfMeasure: 'kg', category: 'Granos', cost: 22000, cash: 25000, transfer: 26000, lowStockThreshold: 10 },
  { key: 'beans', name: 'Frijoles negros', unitOfMeasure: 'kg', category: 'Granos', cost: 30000, cash: 35000, transfer: 36500, lowStockThreshold: 6 },
  { key: 'soda', name: 'Refresco de cola 1.5 L', unitOfMeasure: 'ud', category: 'Bebidas', cost: 28000, cash: 35000, transfer: 36000, lowStockThreshold: 12 },
  { key: 'milk', name: 'Leche en polvo 1 kg', unitOfMeasure: 'ud', category: 'Lácteos', cost: 180000, cash: 220000, transfer: 230000, lowStockThreshold: 6 },
  { key: 'detergent', name: 'Detergente 1 kg', unitOfMeasure: 'ud', category: 'Limpieza', cost: 45000, cash: 55000, transfer: 57000, lowStockThreshold: 4 },
] as const;

type ProductKey = (typeof DEMO_PRODUCTS)[number]['key'];
/** Index of a demo location in `seedDemo`'s list: 0 is P1, 1 is P2. */
type LocationIndex = 0 | 1;

/** Overrides in P2 (the base price applies in P1). */
export const DEMO_LOCATION_PRICES: readonly { location: LocationIndex; product: ProductKey; cash: number; transfer: number }[] = [
  { location: 1, product: 'rice', cash: 26000, transfer: 27000 },
  { location: 1, product: 'soda', cash: 37000, transfer: 38000 },
];

interface Line {
  readonly product: ProductKey;
  readonly quantity: number;
  /** Entries only: what was paid per unit, in minor units. */
  readonly unitCost?: number;
}

/**
 * Demo documents in ledger order. Fixed ids and dates make them idempotent: a re-run sends
 * the same body with the same id, which the API answers as a replay (no new rows, no audit).
 */
export type DemoDocument =
  | { readonly kind: 'entry'; readonly id: string; readonly location: LocationIndex; readonly occurredAt: string; readonly lines: readonly Line[] }
  | {
      readonly kind: 'exit';
      readonly id: string;
      readonly location: LocationIndex;
      readonly reason: 'shrinkage' | 'owner_withdrawal';
      readonly occurredAt: string;
      readonly lines: readonly Line[];
    }
  | { readonly kind: 'transfer'; readonly id: string; readonly from: LocationIndex; readonly to: LocationIndex; readonly occurredAt: string; readonly lines: readonly Line[] };

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    kind: 'entry',
    id: '01990000-0000-7000-8000-000000000101',
    location: 0,
    occurredAt: '2026-11-02T13:00:00.000Z',
    lines: [
      { product: 'rice', quantity: 50, unitCost: 22000 },
      { product: 'beans', quantity: 40, unitCost: 30000 },
      { product: 'soda', quantity: 48, unitCost: 28000 },
      { product: 'milk', quantity: 20, unitCost: 180000 },
      { product: 'detergent', quantity: 24, unitCost: 45000 },
    ],
  },
  {
    kind: 'entry',
    id: '01990000-0000-7000-8000-000000000102',
    location: 1,
    occurredAt: '2026-11-03T13:00:00.000Z',
    lines: [
      { product: 'rice', quantity: 30, unitCost: 22500 },
      { product: 'soda', quantity: 24, unitCost: 28500 },
      { product: 'detergent', quantity: 12, unitCost: 46000 },
    ],
  },
  {
    kind: 'entry',
    id: '01990000-0000-7000-8000-000000000103',
    location: 0,
    occurredAt: '2026-11-10T13:00:00.000Z',
    lines: [
      { product: 'rice', quantity: 25, unitCost: 23000 },
      { product: 'soda', quantity: 24, unitCost: 29000 },
    ],
  },
  {
    kind: 'exit',
    id: '01990000-0000-7000-8000-000000000104',
    location: 0,
    reason: 'shrinkage',
    occurredAt: '2026-11-12T15:00:00.000Z',
    lines: [
      { product: 'soda', quantity: 3 },
      { product: 'rice', quantity: 1.5 },
    ],
  },
  {
    kind: 'exit',
    id: '01990000-0000-7000-8000-000000000105',
    location: 1,
    reason: 'owner_withdrawal',
    occurredAt: '2026-11-13T15:00:00.000Z',
    lines: [{ product: 'detergent', quantity: 2 }],
  },
  {
    kind: 'transfer',
    id: '01990000-0000-7000-8000-000000000106',
    from: 0,
    to: 1,
    occurredAt: '2026-11-14T14:00:00.000Z',
    lines: [
      { product: 'milk', quantity: 5 },
      { product: 'beans', quantity: 10 },
    ],
  },
];

export interface DemoOwner {
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  /** In `DEMO_LOCATIONS` order: P1, P2. */
  readonly locationIds: readonly string[];
}

/** The demo Owner as an authenticated actor (tenant-wide system role), so every write goes through the use cases. */
function ownerRequest(owner: DemoOwner): AdminRequest {
  const assignments = [
    { role: { id: owner.roleId, key: 'owner' as const, isSystem: true, permissions: SYSTEM_ROLES.owner.permissions }, scope: { type: 'tenant' as const } },
  ];
  return {
    actor: {
      userId: owner.userId,
      tenantId: owner.tenantId,
      assignments,
      effective: effectivePermissions(assignments),
      deviceId: 'db-seed',
      sessionId: 'db-seed',
      mustChangePassword: false,
    },
    ip: null,
  };
}

async function ensureProducts(db: Database, request: AdminRequest, clock: Clock): Promise<Map<ProductKey, string>> {
  const createProduct = new CreateProduct(new DrizzleCatalogUnitOfWork(db), clock);
  const ids = new Map<ProductKey, string>();
  for (const product of DEMO_PRODUCTS) {
    const [existing] = await withTenant(db, request.actor.tenantId, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, product.name)).orderBy(products.id).limit(1),
    );
    const id =
      existing?.id ??
      (
        await createProduct.execute(request, {
          name: product.name,
          unitOfMeasure: product.unitOfMeasure,
          category: product.category,
          currency: CURRENCY,
          costPrice: cup(product.cost),
          cashPrice: cup(product.cash),
          transferPrice: cup(product.transfer),
          lowStockThreshold: product.lowStockThreshold,
        })
      ).id;
    ids.set(product.key, id);
  }
  return ids;
}

/** Sets each override only while that location has none, so a re-run writes nothing (and audits nothing). */
async function ensureLocationPrices(db: Database, request: AdminRequest, clock: Clock, owner: DemoOwner, productIds: ReadonlyMap<ProductKey, string>): Promise<void> {
  const setLocationPrice = new SetLocationPrice(new DrizzleCatalogUnitOfWork(db), clock);
  for (const price of DEMO_LOCATION_PRICES) {
    const locationId = owner.locationIds[price.location]!;
    const productId = productIds.get(price.product)!;
    const [row] = await withTenant(db, owner.tenantId, (tx) =>
      tx
        .select({ cash: locationProducts.cashPriceOverride, transfer: locationProducts.transferPriceOverride })
        .from(locationProducts)
        .where(and(eq(locationProducts.locationId, locationId), eq(locationProducts.productId, productId))),
    );
    if (row && (row.cash !== null || row.transfer !== null)) continue;
    await setLocationPrice.execute(request, locationId, productId, { cashPrice: cup(price.cash), transferPrice: cup(price.transfer) });
  }
}

async function recordDocuments(db: Database, request: AdminRequest, clock: Clock, owner: DemoOwner, productIds: ReadonlyMap<ProductKey, string>): Promise<void> {
  const uow = new DrizzleInventoryUnitOfWork(db);
  const entry = new RecordEntry(uow, clock);
  const exit = new RecordExit(uow, clock);
  const transfer = new RecordTransfer(uow, clock);
  const productId = (key: ProductKey) => productIds.get(key)!;
  const locationId = (index: LocationIndex) => owner.locationIds[index]!;

  for (const doc of DEMO_DOCUMENTS) {
    switch (doc.kind) {
      case 'entry':
        await entry.execute(request, {
          id: doc.id,
          locationId: locationId(doc.location),
          occurredAt: doc.occurredAt,
          lines: doc.lines.map((line) => ({ productId: productId(line.product), quantity: line.quantity, unitCost: cup(line.unitCost!) })),
        });
        break;
      case 'exit':
        await exit.execute(request, {
          id: doc.id,
          locationId: locationId(doc.location),
          reason: doc.reason,
          occurredAt: doc.occurredAt,
          lines: doc.lines.map((line) => ({ productId: productId(line.product), quantity: line.quantity })),
        });
        break;
      case 'transfer':
        await transfer.execute(request, {
          id: doc.id,
          fromLocationId: locationId(doc.from),
          toLocationId: locationId(doc.to),
          occurredAt: doc.occurredAt,
          lines: doc.lines.map((line) => ({ productId: productId(line.product), quantity: line.quantity })),
        });
        break;
    }
  }
}

/**
 * Demo catalog, P2 price overrides and inventory documents (entries, exits and one transfer),
 * written as the demo Owner through the catalog and inventory use cases: the same validation,
 * locking, stock and average-cost rules (`@monaco/domain`) and audit as the HTTP API.
 * Idempotent: products are found by name, overrides are set only when missing, and the
 * documents have fixed ids (a re-run is an idempotent replay).
 */
export async function seedDemoInventory(db: Database, owner: DemoOwner, clock: Clock): Promise<void> {
  const request = ownerRequest(owner);
  const productIds = await ensureProducts(db, request, clock);
  await ensureLocationPrices(db, request, clock, owner, productIds);
  await recordDocuments(db, request, clock, owner, productIds);
}
