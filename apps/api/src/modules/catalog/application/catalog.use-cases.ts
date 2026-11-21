import {
  type CreateProductRequest,
  type CurrencyCode,
  type ListProductsQuery,
  type Money,
  type Paginated,
  type Product,
  type ProductWithLocationPrice,
  type SetLocationPriceRequest,
  type UpdateProductRequest,
} from '@monaco/contracts';
import { isCategory, isUnitOfMeasure } from '@monaco/domain';

import { type AdminRequest, iso, isoOrNull } from '../../iam/application/admin-support';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import type { Clock } from '../../iam/domain/auth-ports';
import { PermissionDenied, ResourceNotFound } from '../../iam/domain/errors';
import { authorize, authorizeRead, can, hasReadAnywhere } from '../../iam/domain/permissions';
import { CurrencyMismatch, InvalidCatalogValue, ProductArchived } from '../domain/catalog-errors';
import type { CatalogUnitOfWork, ProductChanges, ProductPriceRecord, ProductRecord } from '../domain/catalog-ports';

/**
 * Costs (D10) go only to someone who writes the catalog or the inventory in that
 * scope: at the asked location, or tenant-wide when no location was asked for.
 */
function canSeeCosts(actor: AuthenticatedActor, locationId?: string): boolean {
  return can(actor.effective, 'catalog:write', locationId) || can(actor.effective, 'inventory:write', locationId);
}

/** Reads need `catalog:view` at the location, or somewhere when there is none (D9: `catalog:write` implies it). */
function authorizeCatalogRead(actor: AuthenticatedActor, locationId?: string): void {
  if (locationId !== undefined) return authorizeRead(actor, 'catalog:view', locationId);
  if (!hasReadAnywhere(actor.effective, 'catalog:view')) throw new PermissionDenied('catalog:view');
}

const money = (amount: number | null, currency: CurrencyCode): Money | null => (amount === null ? null : { amount, currency });

function toProduct(record: ProductRecord, showCosts: boolean): Product {
  return {
    id: record.id,
    name: record.name,
    unitOfMeasure: record.unitOfMeasure,
    category: record.category,
    currency: record.currency,
    costPrice: showCosts ? money(record.costPrice, record.currency) : null,
    cashPrice: money(record.cashPrice, record.currency),
    transferPrice: money(record.transferPrice, record.currency),
    lowStockThreshold: record.lowStockThreshold,
    expirationDate: record.expirationDate,
    archivedAt: isoOrNull(record.archivedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

/** Effective price = location override, else the base price. */
function toPricedProduct(record: ProductPriceRecord, showCosts: boolean): ProductWithLocationPrice {
  return {
    ...toProduct(record, showCosts),
    effectiveCashPrice: money(record.cashPriceOverride ?? record.cashPrice, record.currency),
    effectiveTransferPrice: money(record.transferPriceOverride ?? record.transferPrice, record.currency),
    cashPriceOverride: money(record.cashPriceOverride, record.currency),
    transferPriceOverride: money(record.transferPriceOverride, record.currency),
  };
}

/** The unit and category lists live in `@monaco/domain`; the contract only bounds their length. */
function assertCatalogValues(values: { unitOfMeasure?: string; category?: string | null }): void {
  if (values.unitOfMeasure !== undefined && !isUnitOfMeasure(values.unitOfMeasure)) {
    throw new InvalidCatalogValue('unitOfMeasure', 'Unknown unit of measure');
  }
  if (values.category != null && !isCategory(values.category)) throw new InvalidCatalogValue('category', 'Unknown category');
}

/** Every amount of a product is in the product's currency. */
function assertCurrency(currency: CurrencyCode, amounts: readonly (Money | null | undefined)[]): void {
  if (amounts.some((amount) => amount != null && amount.currency !== currency)) throw new CurrencyMismatch('amount_currency');
}

const amountOf = (value: Money | null | undefined): number | null | undefined => (value === undefined ? undefined : (value?.amount ?? null));

/** Drops `undefined` so that "not sent" keeps the column and `null` clears it. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** GET /products: `catalog:view` at `?locationId`, or anywhere without it. Base prices, or effective ones for a location. */
export class ListProducts {
  constructor(private readonly uow: CatalogUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: ListProductsQuery): Promise<Paginated<ProductWithLocationPrice>> {
    authorizeCatalogRead(actor, query.locationId);
    const showCosts = canSeeCosts(actor, query.locationId);
    const page = await this.uow.run(actor.tenantId, async (scope) => {
      if (query.locationId !== undefined && !(await scope.locationPrices.locationExists(query.locationId))) throw new ResourceNotFound('location');
      return scope.products.list({ ...query, includeArchived: query.includeArchived ?? false });
    });
    return { items: page.items.map((record) => toPricedProduct(record, showCosts)), nextCursor: page.nextCursor };
  }
}

/** GET /products/:id: same rules as the list; a product of another tenant is a 404 (RLS). */
export class GetProduct {
  constructor(private readonly uow: CatalogUnitOfWork) {}

  async execute(actor: AuthenticatedActor, id: string, locationId?: string): Promise<ProductWithLocationPrice> {
    authorizeCatalogRead(actor, locationId);
    const showCosts = canSeeCosts(actor, locationId);
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      if (locationId !== undefined && !(await scope.locationPrices.locationExists(locationId))) throw new ResourceNotFound('location');
      return scope.products.findById(id, locationId);
    });
    if (!record) throw new ResourceNotFound('product');
    return toPricedProduct(record, showCosts);
  }
}

/** POST /products: `catalog:write` tenant-wide (D14). */
export class CreateProduct {
  constructor(
    private readonly uow: CatalogUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, input: CreateProductRequest): Promise<Product> {
    authorize(actor, 'catalog:write');
    assertCatalogValues(input);
    assertCurrency(input.currency, [input.costPrice, input.cashPrice, input.transferPrice]);
    const now = this.clock.now();
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const created = await scope.products.create({
        ...definedOnly({
          category: input.category,
          lowStockThreshold: input.lowStockThreshold,
          expirationDate: input.expirationDate,
          costPrice: amountOf(input.costPrice),
          cashPrice: amountOf(input.cashPrice),
          transferPrice: amountOf(input.transferPrice),
        }),
        name: input.name,
        unitOfMeasure: input.unitOfMeasure,
        currency: input.currency,
        now,
      });
      // Never costs in the audit log.
      await scope.audit.record({
        type: 'product_created',
        actorUserId: actor.userId,
        targetType: 'product',
        targetId: created.id,
        metadata: { name: created.name, unitOfMeasure: created.unitOfMeasure, category: created.category, currency: created.currency },
        ip,
      });
      return created;
    });
    return toProduct(record, true);
  }
}

/**
 * PATCH /products/:id: `catalog:write` tenant-wide. The row is locked first (it
 * waits for inventory documents, which read it FOR SHARE), so "has movements"
 * cannot change under the currency check.
 */
export class UpdateProduct {
  constructor(
    private readonly uow: CatalogUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, id: string, input: UpdateProductRequest): Promise<Product> {
    authorize(actor, 'catalog:write');
    assertCatalogValues(input);
    const now = this.clock.now();
    const changes: ProductChanges = definedOnly({
      name: input.name,
      unitOfMeasure: input.unitOfMeasure,
      category: input.category,
      currency: input.currency,
      lowStockThreshold: input.lowStockThreshold,
      expirationDate: input.expirationDate,
      costPrice: amountOf(input.costPrice),
      cashPrice: amountOf(input.cashPrice),
      transferPrice: amountOf(input.transferPrice),
    });
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const current = await scope.products.lockForUpdate(id);
      if (!current) throw new ResourceNotFound('product');
      const currency = input.currency ?? current.currency;
      assertCurrency(currency, [input.costPrice, input.cashPrice, input.transferPrice]);
      if (currency !== current.currency && (await scope.products.hasMovements(id))) throw new CurrencyMismatch('has_movements');
      const updated = await scope.products.update(id, changes, now);
      await scope.audit.record({
        type: 'product_updated',
        actorUserId: actor.userId,
        targetType: 'product',
        targetId: id,
        metadata: { fields: Object.keys(changes) },
        ip,
      });
      return updated;
    });
    return toProduct(record, true);
  }
}

/** POST /products/:id/archive: `catalog:write` tenant-wide. Idempotent: the first archive date is kept. */
export class ArchiveProduct {
  constructor(
    private readonly uow: CatalogUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, id: string): Promise<Product> {
    authorize(actor, 'catalog:write');
    const now = this.clock.now();
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const archived = await scope.products.archive(id, now);
      if (!archived) throw new ResourceNotFound('product');
      // Archiving again is a no-op (the first date is kept): nothing to audit.
      if (archived.archivedAt?.getTime() !== now.getTime()) return archived;
      await scope.audit.record({ type: 'product_archived', actorUserId: actor.userId, targetType: 'product', targetId: id, ip });
      return archived;
    });
    return toProduct(record, true);
  }
}

/**
 * PUT /locations/:locationId/products/:productId/price: `catalog:write` at that
 * location (D14). The product is read FOR SHARE, so an archive waits for it; an
 * archived product takes no override. `null` removes an override.
 */
export class SetLocationPrice {
  constructor(
    private readonly uow: CatalogUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, locationId: string, productId: string, input: SetLocationPriceRequest): Promise<ProductWithLocationPrice> {
    authorize(actor, 'catalog:write', locationId);
    const now = this.clock.now();
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const product = await scope.products.lockForShare(productId);
      if (!product) throw new ResourceNotFound('product');
      if (product.archivedAt !== null) throw new ProductArchived();
      assertCurrency(product.currency, [input.cashPrice, input.transferPrice]);
      if (!(await scope.locationPrices.locationExists(locationId))) throw new ResourceNotFound('location');
      const cashPrice = input.cashPrice?.amount ?? null;
      const transferPrice = input.transferPrice?.amount ?? null;
      await scope.locationPrices.set({ locationId, productId, cashPrice, transferPrice, now });
      await scope.audit.record({
        type: 'location_price_set',
        actorUserId: actor.userId,
        targetType: 'product',
        targetId: productId,
        metadata: { locationId, cashPrice, transferPrice },
        ip,
      });
      return scope.products.findById(productId, locationId);
    });
    if (!record) throw new ResourceNotFound('product');
    return toPricedProduct(record, canSeeCosts(actor, locationId));
  }
}
