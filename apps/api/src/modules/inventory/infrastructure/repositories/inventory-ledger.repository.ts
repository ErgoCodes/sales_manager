import type { LedgerLine } from '@monaco/domain';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type {
  InventoryLedger,
  LocationState,
  LockedPair,
  NewDocumentHeader,
  NewMovement,
  PairKey,
  ProductState,
  StoredDocument,
  StoredMovement,
} from '../../domain/inventory-ports';
import { pairKey } from '../../domain/inventory-ports';

type Dated = Date | string;

interface DocumentRow {
  id: string;
  kind: StoredDocument['kind'];
  locationId: string;
  locationName: string;
  targetLocationId: string | null;
  targetLocationName: string | null;
  reason: StoredDocument['reason'];
  reversesDocumentId: string | null;
  occurredAt: Dated;
  notes: string | null;
  payloadHash: string;
  createdBy: string;
  createdAt: Dated;
}

interface MovementRow {
  id: string;
  documentId: string;
  locationId: string;
  productId: string;
  kind: StoredMovement['kind'];
  quantityDelta: string;
  unitCost: string;
  currency: StoredMovement['currency'];
  reversesMovementId: string | null;
  createdAt: Dated;
}

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

/** The (location, product) pairs as two parallel arrays, in the order given, for `unnest`. */
const pairArrays = (pairs: readonly PairKey[]) => ({
  locations: uuids(pairs.map((pair) => pair.locationId)),
  products: uuids(pairs.map((pair) => pair.productId)),
});

/**
 * The ledger of the current tenant on one `withTenant` transaction (ADR 0006).
 * Append-only: monaco_app only has INSERT and SELECT on the two ledger tables.
 * Stock is never stored; it is `SUM(quantity_delta)`.
 */
export class InventoryLedgerRepository implements InventoryLedger {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async insertDocumentHeader(header: NewDocumentHeader): Promise<boolean> {
    // The id is the PK across tenants: another tenant's row (invisible to RLS) also
    // makes this a no-op, and the caller then finds nothing to compare with -> conflict.
    // No conflict target on purpose: `on conflict (id)` only arbitrates the PK, so two
    // concurrent inserts of the same id raced onto the second unique index, (id, tenant_id),
    // and the loser got a 23505 instead of a skip (seen as a 409 in ~1 of 60 retries).
    // Without a target every unique index arbitrates, including (tenant_id, reverses_document_id):
    // a second reversal of the same document waits for the first and is skipped once it commits,
    // so a false here may also mean "already reversed" (the script checks findReversalOf).
    const inserted = await rows<{ id: string }>(
      this.tx,
      sql`insert into inventory_documents
            (id, tenant_id, kind, location_id, target_location_id, reason, reverses_document_id, occurred_at, notes, payload_hash, created_by)
          values (${header.id}, ${this.tenantId}, ${header.kind}, ${header.locationId}, ${header.targetLocationId}, ${header.reason},
                  ${header.reversesDocumentId},
                  ${header.occurredAt}, ${header.notes}, ${header.payloadHash}, ${header.createdBy})
          on conflict do nothing
          returning id`,
    );
    return inserted.length === 1;
  }

  async findDocument(id: string): Promise<StoredDocument | null> {
    const [document] = await rows<DocumentRow>(
      this.tx,
      sql`select d.id, d.kind, d.location_id as "locationId", l.name as "locationName",
                 d.target_location_id as "targetLocationId", t.name as "targetLocationName", d.reason,
                 d.reverses_document_id as "reversesDocumentId", d.occurred_at as "occurredAt", d.notes,
                 d.payload_hash as "payloadHash", d.created_by as "createdBy", d.created_at as "createdAt"
          from inventory_documents d
          join locations l on l.id = d.location_id and l.tenant_id = d.tenant_id
          left join locations t on t.id = d.target_location_id and t.tenant_id = d.tenant_id
          where d.id = ${id}`,
    );
    if (!document) return null;
    const movements = await rows<MovementRow>(
      this.tx,
      sql`select m.id, m.document_id as "documentId", m.location_id as "locationId", m.product_id as "productId", m.kind,
                 m.quantity_delta::text as "quantityDelta", m.unit_cost::text as "unitCost", p.currency,
                 m.reverses_movement_id as "reversesMovementId", m.created_at as "createdAt"
          from inventory_movements m
          join products p on p.id = m.product_id and p.tenant_id = m.tenant_id
          where m.tenant_id = ${this.tenantId} and m.document_id = ${id}
          order by m.created_at, m.id`,
    );
    return {
      ...document,
      occurredAt: toDate(document.occurredAt),
      createdAt: toDate(document.createdAt),
      movements: movements.map((movement) => ({
        ...movement,
        quantityDelta: Number(movement.quantityDelta),
        unitCost: Number(movement.unitCost),
        createdAt: toDate(movement.createdAt),
      })),
    };
  }

  async findReversalOf(documentId: string): Promise<string | null> {
    const [reversal] = await rows<{ id: string }>(
      this.tx,
      sql`select id from inventory_documents where tenant_id = ${this.tenantId} and reverses_document_id = ${documentId}`,
    );
    return reversal?.id ?? null;
  }

  async pairLedger(pair: PairKey): Promise<LedgerLine[]> {
    const lines = await rows<{ documentId: string; kind: LedgerLine['kind']; quantityDelta: string; unitCost: string; reversesDocumentId: string | null }>(
      this.tx,
      sql`select m.document_id as "documentId", m.kind, m.quantity_delta::text as "quantityDelta", m.unit_cost::text as "unitCost",
                 d.reverses_document_id as "reversesDocumentId"
          from inventory_movements m
          join inventory_documents d on d.id = m.document_id and d.tenant_id = m.tenant_id
          where m.tenant_id = ${this.tenantId} and m.location_id = ${pair.locationId} and m.product_id = ${pair.productId}
          order by m.created_at, m.id`,
    );
    return lines.map((line) => ({ ...line, quantityDelta: Number(line.quantityDelta), unitCost: Number(line.unitCost) }));
  }

  async lockLocations(ids: readonly string[]): Promise<LocationState[]> {
    const found = await rows<{ id: string; archivedAt: Dated | null }>(
      this.tx,
      sql`select id, archived_at as "archivedAt" from locations where id = any(${uuids(ids)}) order by id for share`,
    );
    return found.map((location) => ({ id: location.id, archivedAt: toDate(location.archivedAt) }));
  }

  async lockProducts(ids: readonly string[]): Promise<ProductState[]> {
    const found = await rows<{ id: string; currency: ProductState['currency']; costPrice: string | number | null; archivedAt: Dated | null }>(
      this.tx,
      sql`select id, currency, cost_price as "costPrice", archived_at as "archivedAt" from products where id = any(${uuids(ids)}) order by id for share`,
    );
    return found.map((product) => ({
      ...product,
      costPrice: product.costPrice === null ? null : Number(product.costPrice),
      archivedAt: toDate(product.archivedAt),
    }));
  }

  async ensureLocationProducts(pairs: readonly PairKey[]): Promise<void> {
    const { locations, products } = pairArrays(pairs);
    // `with ordinality` + `order by` keeps the insertion in the caller's (sorted) order.
    await this.tx.execute(
      sql`insert into location_products (tenant_id, location_id, product_id)
          select ${this.tenantId}::uuid, t.location_id, t.product_id
          from unnest(${locations}, ${products}) with ordinality as t(location_id, product_id, n)
          order by t.n
          on conflict do nothing`,
    );
  }

  async lockLocationProducts(pairs: readonly PairKey[]): Promise<LockedPair[]> {
    const { locations, products } = pairArrays(pairs);
    const locked = await rows<{ locationId: string; productId: string; averageCost: string }>(
      this.tx,
      sql`select lp.location_id as "locationId", lp.product_id as "productId", lp.average_cost::text as "averageCost"
          from location_products lp
          where lp.tenant_id = ${this.tenantId}
            and (lp.location_id, lp.product_id) in (select t.location_id, t.product_id from unnest(${locations}, ${products}) as t(location_id, product_id))
          order by lp.location_id, lp.product_id
          for update of lp`,
    );
    return locked.map((pair) => ({ locationId: pair.locationId, productId: pair.productId, averageCost: Number(pair.averageCost) }));
  }

  async sumStock(pairs: readonly PairKey[]): Promise<ReadonlyMap<string, number>> {
    const { locations, products } = pairArrays(pairs);
    const sums = await rows<{ locationId: string; productId: string; stock: string }>(
      this.tx,
      sql`select m.location_id as "locationId", m.product_id as "productId", sum(m.quantity_delta)::text as stock
          from inventory_movements m
          where m.tenant_id = ${this.tenantId}
            and (m.location_id, m.product_id) in (select t.location_id, t.product_id from unnest(${locations}, ${products}) as t(location_id, product_id))
          group by m.location_id, m.product_id`,
    );
    return new Map(sums.map((sum) => [pairKey(sum), Number(sum.stock)]));
  }

  async insertMovements(documentId: string, movements: readonly NewMovement[]): Promise<void> {
    if (movements.length === 0) return;
    // clock_timestamp(), not now(): it is read after the pair locks, so the order of
    // created_at inside a pair follows the lock (commit) order, which a replay of the ledger needs.
    const values = movements.map(
      (movement) =>
        sql`(${uuidv7()}, ${this.tenantId}, ${documentId}, ${movement.locationId}, ${movement.productId}, ${movement.kind},
             ${movement.quantityDelta}, ${movement.unitCost}, ${movement.reversesMovementId ?? null}, clock_timestamp())`,
    );
    await this.tx.execute(
      sql`insert into inventory_movements
            (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost, reverses_movement_id, created_at)
          values ${sql.join(values, sql`, `)}`,
    );
  }

  async setAverageCost(pair: PairKey, averageCost: number): Promise<void> {
    await this.tx.execute(
      sql`update location_products set average_cost = ${averageCost.toFixed(6)}, updated_at = now()
          where tenant_id = ${this.tenantId} and location_id = ${pair.locationId} and product_id = ${pair.productId}`,
    );
  }
}
