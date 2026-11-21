import type {
  InventoryDocument,
  InventoryMovement,
  MovementsQuery,
  Paginated,
  ProductStock,
  StockItem,
  StockQuery,
} from '@monaco/contracts';
import { getProductThreshold } from '@monaco/domain';

import { isoOrNull } from '../../iam/application/admin-support';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { PermissionDenied, ResourceNotFound } from '../../iam/domain/errors';
import { authorizeRead, hasReadAnywhere } from '../../iam/domain/permissions';
import type { InventoryUnitOfWork, MovementFilter, StockRecord } from '../domain/inventory-ports';
import { documentLocations, type LedgerView, ledgerView, toDocument, toMovement } from './document-mapper';

/**
 * General low-stock threshold passed to `getProductThreshold` when neither the
 * product nor its category has one. Mobile's default (configurable there); the
 * platform has no tenant setting for it yet.
 */
export const GENERAL_STOCK_THRESHOLD = 5;

const thresholdOf = (record: StockRecord): number => getProductThreshold(record, GENERAL_STOCK_THRESHOLD);
const isLow = (record: StockRecord): boolean => record.quantity < thresholdOf(record);

function toStockItem(record: StockRecord, view: LedgerView, locationId: string): StockItem {
  return {
    productId: record.productId,
    name: record.name,
    unitOfMeasure: record.unitOfMeasure,
    category: record.category,
    quantity: record.quantity,
    lowStockThreshold: thresholdOf(record),
    isLow: isLow(record),
    averageCost: view.canSeeCosts(locationId) ? { amount: record.averageCost, currency: record.currency } : null,
    archivedAt: isoOrNull(record.archivedAt),
  };
}

/** Drops `undefined` so the reader sees only the filters that were sent. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * GET /locations/:locationId/stock: `inventory:view` at the location (D9: write or
 * transfer imply it). `?lowStockOnly` keeps the products under the effective
 * threshold of the domain; average cost only for writers there (D10).
 */
export class GetLocationStock {
  constructor(private readonly uow: InventoryUnitOfWork) {}

  async execute(actor: AuthenticatedActor, locationId: string, query: StockQuery): Promise<Paginated<StockItem>> {
    authorizeRead(actor, 'inventory:view', locationId);
    const view = ledgerView(actor.effective);
    const page = await this.uow.run(actor.tenantId, async ({ reader }) => {
      if (!(await reader.locationExists(locationId))) throw new ResourceNotFound('location');
      const keep = query.lowStockOnly ? isLow : undefined;
      return reader.listStock(locationId, { ...definedOnly({ q: query.q, cursor: query.cursor }), limit: query.limit }, keep);
    });
    return { items: page.items.map((record) => toStockItem(record, view, locationId)), nextCursor: page.nextCursor };
  }
}

/** GET /products/:id/stock: the product's stock in the locations where the actor has `inventory:view`, and only those. */
export class GetProductStock {
  constructor(private readonly uow: InventoryUnitOfWork) {}

  async execute(actor: AuthenticatedActor, productId: string): Promise<ProductStock> {
    if (!hasReadAnywhere(actor.effective, 'inventory:view')) throw new PermissionDenied('inventory:view');
    const view = ledgerView(actor.effective);
    const locations = await this.uow.run(actor.tenantId, async ({ reader }) => {
      if (!(await reader.productExists(productId))) throw new ResourceNotFound('product');
      return reader.productStock(productId);
    });
    return {
      productId,
      locations: locations
        .filter((location) => view.canView(location.locationId))
        .map((location) => ({
          locationId: location.locationId,
          locationName: location.locationName,
          quantity: location.quantity,
          averageCost: view.canSeeCosts(location.locationId) ? { amount: location.averageCost, currency: location.currency } : null,
        })),
    };
  }
}

/**
 * GET /locations/:locationId/inventory-movements: `inventory:view` at the location.
 * The other location of a transfer shows only with `inventory:view` there.
 */
export class ListLocationMovements {
  constructor(private readonly uow: InventoryUnitOfWork) {}

  async execute(actor: AuthenticatedActor, locationId: string, query: MovementsQuery): Promise<Paginated<InventoryMovement>> {
    authorizeRead(actor, 'inventory:view', locationId);
    const view = ledgerView(actor.effective);
    const filter: MovementFilter = definedOnly({
      productId: query.productId,
      kind: query.kind,
      from: query.from === undefined ? undefined : new Date(query.from),
      to: query.to === undefined ? undefined : new Date(query.to),
    });
    const page = await this.uow.run(actor.tenantId, async ({ reader }) => {
      if (!(await reader.locationExists(locationId))) throw new ResourceNotFound('location');
      return reader.listMovements(locationId, { ...filter, ...definedOnly({ cursor: query.cursor }), limit: query.limit });
    });
    return {
      items: page.items.map((record) =>
        toMovement(record, { id: record.counterpartLocationId, name: record.counterpartLocationName }, view),
      ),
      nextCursor: page.nextCursor,
    };
  }
}

/**
 * GET /inventory/documents/:id: `inventory:view` in at least one location of the
 * document. Locations the actor cannot view are masked ("otro punto") and their
 * movements left out (spec, "Enmascarado entre puntos").
 */
export class GetInventoryDocument {
  constructor(private readonly uow: InventoryUnitOfWork) {}

  async execute(actor: AuthenticatedActor, id: string): Promise<InventoryDocument> {
    if (!hasReadAnywhere(actor.effective, 'inventory:view')) throw new PermissionDenied('inventory:view');
    const view = ledgerView(actor.effective);
    const stored = await this.uow.run(actor.tenantId, ({ ledger }) => ledger.findDocument(id));
    if (!stored) throw new ResourceNotFound('inventory_document');
    if (!documentLocations(stored).some((locationId) => view.canView(locationId))) throw new PermissionDenied('inventory:view');
    return toDocument(stored, view);
  }
}
