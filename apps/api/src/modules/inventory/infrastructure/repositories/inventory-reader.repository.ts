import type { Paginated } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type {
  InventoryReader,
  LocationStockRecord,
  MovementFilter,
  MovementRecord,
  StockRecord,
} from '../../domain/inventory-ports';

type Dated = Date | string;

/** node-postgres returns numeric as strings. */
type StockRow = Omit<StockRecord, 'lowStockThreshold' | 'archivedAt' | 'quantity' | 'averageCost'> & {
  lowStockThreshold: string | null;
  archivedAt: Dated | null;
  quantity: string;
  averageCost: string;
};

type LocationStockRow = Omit<LocationStockRecord, 'quantity' | 'averageCost'> & { quantity: string; averageCost: string };

type MovementRow = Omit<MovementRecord, 'quantityDelta' | 'unitCost' | 'createdAt'> & {
  quantityDelta: string;
  unitCost: string;
  createdAt: Dated;
  /** created_at with its microseconds (a JS Date would round them away). */
  cursorAt: string;
};

const toStock = (row: StockRow): StockRecord => ({
  ...row,
  lowStockThreshold: row.lowStockThreshold === null ? null : Number(row.lowStockThreshold),
  archivedAt: toDate(row.archivedAt),
  quantity: Number(row.quantity),
  averageCost: Number(row.averageCost),
});

/**
 * Read side of the ledger on one `withTenant` transaction. Stock is always
 * `SUM(quantity_delta)` (ADR 0006), never a stored column; RLS keeps every
 * query inside the tenant, so another tenant's ids simply find nothing.
 */
/** Smallest stock batch read per query while filtering pages in memory. */
export const MIN_STOCK_BATCH = 100;

export class InventoryReaderRepository implements InventoryReader {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async locationExists(id: string): Promise<boolean> {
    return (await rows(this.tx, sql`select 1 as one from locations where id = ${id}`)).length > 0;
  }

  async productExists(id: string): Promise<boolean> {
    return (await rows(this.tx, sql`select 1 as one from products where id = ${id}`)).length > 0;
  }

  /**
   * Reads batches of at least `limit + 1` rows (never fewer than `MIN_STOCK_BATCH`, so a
   * sparse filter such as low stock does not cost one query per product) after the cursor and keeps those `keep` accepts,
   * until one more than a page is kept or the products run out. The low-stock rule
   * stays in the use case (`getProductThreshold`), and pagination stays exact.
   */
  async listStock(locationId: string, page: PageRequest & { readonly q?: string }, keep: (record: StockRecord) => boolean = () => true): Promise<Paginated<StockRecord>> {
    let after = decodeCursor(page.cursor, ['text', 'uuid']);
    const kept: StockRecord[] = [];
    const batch = Math.max(page.limit + 1, MIN_STOCK_BATCH);
    for (;;) {
      const found = (await this.stockBatch(locationId, page.q, after, batch)).map(toStock);
      kept.push(...found.filter(keep));
      const last = found.at(-1);
      if (kept.length > page.limit || found.length < batch || last === undefined) break;
      after = [last.name, last.productId];
    }
    return toPage(kept, page.limit, (last) => [last.name, last.productId]);
  }

  private stockBatch(locationId: string, q: string | undefined, after: string[] | undefined, limit: number): Promise<StockRow[]> {
    return rows<StockRow>(
      this.tx,
      sql`select p.id as "productId", p.name, p.unit_of_measure as "unitOfMeasure", p.category, p.currency,
                 p.low_stock_threshold::text as "lowStockThreshold", p.archived_at as "archivedAt",
                 coalesce(s.quantity, 0)::text as quantity, coalesce(lp.average_cost, 0)::text as "averageCost"
          from products p
          left join location_products lp on lp.tenant_id = p.tenant_id and lp.product_id = p.id and lp.location_id = ${locationId}::uuid
          left join lateral (
            select sum(m.quantity_delta) as quantity from inventory_movements m
            where m.tenant_id = p.tenant_id and m.location_id = ${locationId}::uuid and m.product_id = p.id
          ) s on true
          where (p.archived_at is null or coalesce(s.quantity, 0) <> 0)
            and (${q ?? null}::text is null or position(lower(${q ?? null}::text) in lower(p.name)) > 0)
            and (${after?.[0] ?? null}::text is null or (p.name, p.id) > (${after?.[0] ?? null}::text, ${after?.[1] ?? null}::uuid))
          order by p.name, p.id limit ${limit}`,
    );
  }

  async productStock(productId: string): Promise<LocationStockRecord[]> {
    const found = await rows<LocationStockRow>(
      this.tx,
      sql`select l.id as "locationId", l.name as "locationName", p.currency,
                 coalesce(s.quantity, 0)::text as quantity, coalesce(lp.average_cost, 0)::text as "averageCost"
          from locations l
          join products p on p.tenant_id = l.tenant_id and p.id = ${productId}::uuid
          left join location_products lp on lp.tenant_id = l.tenant_id and lp.location_id = l.id and lp.product_id = p.id
          left join lateral (
            select sum(m.quantity_delta) as quantity from inventory_movements m
            where m.tenant_id = l.tenant_id and m.location_id = l.id and m.product_id = p.id
          ) s on true
          where l.archived_at is null or coalesce(s.quantity, 0) <> 0
          order by l.name, l.id`,
    );
    return found.map((row) => ({ ...row, quantity: Number(row.quantity), averageCost: Number(row.averageCost) }));
  }

  /**
   * The counterpart is the other location of a transfer document, seen from this
   * movement's location; the use case decides whether the actor may see it.
   */
  async listMovements(locationId: string, page: PageRequest & MovementFilter): Promise<Paginated<MovementRecord>> {
    const [at = null, id = null] = decodeCursor(page.cursor, ['timestamp', 'uuid']) ?? [];
    const found = await rows<MovementRow>(
      this.tx,
      sql`select m.id, m.document_id as "documentId", m.location_id as "locationId", m.product_id as "productId", m.kind,
                 m.quantity_delta::text as "quantityDelta", m.unit_cost::text as "unitCost", p.currency,
                 m.reverses_movement_id as "reversesMovementId", m.created_at as "createdAt",
                 to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt",
                 c.id as "counterpartLocationId", c.name as "counterpartLocationName"
          from inventory_movements m
          join products p on p.id = m.product_id and p.tenant_id = m.tenant_id
          join inventory_documents d on d.id = m.document_id and d.tenant_id = m.tenant_id
          left join locations c on c.tenant_id = d.tenant_id and d.kind = 'transfer'
            and c.id = case when m.location_id = d.location_id then d.target_location_id else d.location_id end
          where m.tenant_id = ${this.tenantId} and m.location_id = ${locationId}::uuid
            and (${page.productId ?? null}::uuid is null or m.product_id = ${page.productId ?? null}::uuid)
            and (${page.kind ?? null}::text is null or m.kind = ${page.kind ?? null}::text)
            and (${page.from ?? null}::timestamptz is null or m.created_at >= ${page.from ?? null}::timestamptz)
            and (${page.to ?? null}::timestamptz is null or m.created_at <= ${page.to ?? null}::timestamptz)
            and (${at}::timestamptz is null or (m.created_at, m.id) < (${at}::timestamptz, ${id}::uuid))
          order by m.created_at desc, m.id desc limit ${page.limit + 1}`,
    );
    const result = toPage(found, page.limit, (last) => [last.cursorAt, last.id]);
    return {
      items: result.items.map(({ cursorAt: _cursorAt, ...row }) => ({
        ...row,
        quantityDelta: Number(row.quantityDelta),
        unitCost: Number(row.unitCost),
        createdAt: toDate(row.createdAt),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
