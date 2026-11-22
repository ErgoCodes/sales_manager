import type { CurrencyCode } from '@monaco/contracts';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../infrastructure/db/database';
import { locationProducts, products, sales } from '../infrastructure/db/schema';
import { withTenant } from '../infrastructure/db/with-tenant';
import { CreateProduct, SetLocationPrice } from '../modules/catalog/application/catalog.use-cases';
import { DrizzleCatalogUnitOfWork } from '../modules/catalog/infrastructure/drizzle-catalog-unit-of-work';
import type { AdminRequest } from '../modules/iam/application/admin-support';
import type { Clock } from '../modules/iam/domain/auth-ports';
import { effectivePermissions } from '../modules/iam/domain/permissions';
import { SYSTEM_ROLES } from '../modules/iam/domain/system-roles';
import { RecordEntry, RecordExit, RecordTransfer } from '../modules/inventory/application/inventory.use-cases';
import { DrizzleInventoryUnitOfWork } from '../modules/inventory/infrastructure/drizzle-inventory-unit-of-work';
import { RecordSale } from '../modules/sales/application/record-sale.use-case';
import { DrizzleSalesUnitOfWork } from '../modules/sales/infrastructure/drizzle-sales-unit-of-work';
import { addDays, DEMO_LOCATION_PRICES, DEMO_PRODUCTS, type LocationIndex, localDate, type PlannedDocument, planDemoHistory } from './demo-history';

const CURRENCY: CurrencyCode = 'CUP';
const cup = (amount: number) => ({ amount, currency: CURRENCY });

export interface DemoOwner {
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  /** In `DEMO_LOCATIONS` order: P1, P2. */
  readonly locationIds: readonly string[];
}

export interface DemoInventoryOptions {
  /** Days of history, today included. */
  readonly historyDays: number;
  /** The tenant's IANA zone: "today" and every document time are local to it (D3). */
  readonly timeZone: string;
}

export interface DemoInventoryResult {
  /** False when the tenant already had sales and the history was left alone. */
  readonly historySeeded: boolean;
  readonly documents: number;
}

/**
 * The demo Owner as an authenticated actor (tenant-wide system role), so every write goes through
 * the use cases. The use cases are called directly, not through HTTP: the `AuthGuard` (and its
 * `403 DEMO_READ_ONLY` for read-only tenants) is not in this path, which is what lets `demo:reset`
 * seed a tenant that the API itself never lets anybody write to.
 */
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

async function ensureProducts(db: Database, request: AdminRequest, clock: Clock, today: string): Promise<Map<string, string>> {
  const createProduct = new CreateProduct(new DrizzleCatalogUnitOfWork(db), clock);
  const ids = new Map<string, string>();
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
          expirationDate: product.expiresInDays === undefined ? null : addDays(today, product.expiresInDays),
        })
      ).id;
    ids.set(product.key, id);
  }
  return ids;
}

/** Sets each override only while that location has none, so a re-run writes nothing (and audits nothing). */
async function ensureLocationPrices(db: Database, request: AdminRequest, clock: Clock, owner: DemoOwner, productIds: ReadonlyMap<string, string>): Promise<void> {
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

/**
 * Writes the planned documents in order, each through its use case (its own `withTenant`
 * transaction, or a savepoint when `db` is already a transaction). The clock lets the use cases
 * accept today's documents dated later than the real now (D14: the reset seeds the whole day and
 * the reports cut at `now()`); it is never earlier than the real clock.
 */
async function recordHistory(db: Database, request: AdminRequest, clock: Clock, owner: DemoOwner, productIds: ReadonlyMap<string, string>, plan: readonly PlannedDocument[]): Promise<void> {
  const horizon = Math.max(0, ...plan.map((doc) => Date.parse(doc.occurredAt)));
  const historyClock: Clock = { now: () => new Date(Math.max(clock.now().getTime(), horizon)) };
  const inventory = new DrizzleInventoryUnitOfWork(db);
  const entry = new RecordEntry(inventory, historyClock);
  const exit = new RecordExit(inventory, historyClock);
  const transfer = new RecordTransfer(inventory, historyClock);
  const sale = new RecordSale(new DrizzleSalesUnitOfWork(db), historyClock);
  const productId = (key: string) => productIds.get(key)!;
  const locationId = (index: LocationIndex) => owner.locationIds[index]!;

  for (const doc of plan) {
    switch (doc.kind) {
      case 'entry':
        await entry.execute(request, {
          id: doc.id,
          locationId: locationId(doc.location),
          occurredAt: doc.occurredAt,
          lines: doc.lines.map((line) => ({ productId: productId(line.product), quantity: line.quantity, unitCost: cup(line.unitCost) })),
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
      case 'sale':
        await sale.execute(request, {
          id: doc.id,
          locationId: locationId(doc.location),
          occurredAt: doc.occurredAt,
          lines: doc.lines.map((line) => ({
            productId: productId(line.product),
            quantity: line.quantity,
            unitPrice: cup(line.unitPrice),
            discountPercent: 0,
            paymentMethod: line.paymentMethod,
            isCostSale: line.isCostSale,
          })),
        });
        break;
    }
  }
}

/**
 * Demo catalog (~40 products), P2 price overrides and the history (entries, shrinkage, owner
 * withdrawals, transfers and sales), written as the demo Owner through the catalog and inventory
 * use cases and RecordSale: the same validation, locking, stock and cost rules (`@monaco/domain`)
 * and audit as the API. Idempotent: products are found by name, overrides are set only when
 * missing, and the history is planned and written only while the tenant has no sales.
 */
export async function seedDemoInventory(db: Database, owner: DemoOwner, clock: Clock, options: DemoInventoryOptions): Promise<DemoInventoryResult> {
  const request = ownerRequest(owner);
  const today = localDate(clock.now(), options.timeZone);
  const productIds = await ensureProducts(db, request, clock, today);
  await ensureLocationPrices(db, request, clock, owner, productIds);

  const [anySale] = await withTenant(db, owner.tenantId, (tx) => tx.select({ id: sales.id }).from(sales).limit(1));
  if (anySale) return { historySeeded: false, documents: 0 };
  const plan = planDemoHistory({ today, timeZone: options.timeZone, historyDays: options.historyDays });
  await recordHistory(db, request, clock, owner, productIds, plan);
  return { historySeeded: true, documents: plan.length };
}
