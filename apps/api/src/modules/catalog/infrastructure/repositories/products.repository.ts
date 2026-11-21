import type { CurrencyCode, Paginated } from '@monaco/contracts';
import { type SQL, sql } from 'drizzle-orm';

import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { NewProduct, ProductChanges, ProductFilter, ProductPriceRecord, ProductRecord, ProductRepository } from '../../domain/catalog-ports';

const COLUMNS = [
  'id',
  'name',
  'unit_of_measure as "unitOfMeasure"',
  'category',
  'currency',
  'cost_price as "costPrice"',
  'cash_price as "cashPrice"',
  'transfer_price as "transferPrice"',
  'low_stock_threshold as "lowStockThreshold"',
  'expiration_date::text as "expirationDate"',
  'archived_at as "archivedAt"',
  'created_at as "createdAt"',
  'updated_at as "updatedAt"',
];
/** The product columns, optionally qualified (the join with `location_products` has its own `updated_at`). */
const columns = (alias?: string): SQL => sql.raw(COLUMNS.map((column) => (alias ? `${alias}.${column}` : column)).join(', '));

/** node-postgres returns bigint and numeric as strings. */
type Row = Omit<ProductRecord, 'costPrice' | 'cashPrice' | 'transferPrice' | 'lowStockThreshold' | 'archivedAt' | 'createdAt' | 'updatedAt' | 'currency'> & {
  currency: string;
  costPrice: string | null;
  cashPrice: string | null;
  transferPrice: string | null;
  lowStockThreshold: string | null;
  archivedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};
type PricedRow = Row & { cashPriceOverride: string | null; transferPriceOverride: string | null };

const num = (value: string | null): number | null => (value === null ? null : Number(value));

const toRecord = (row: Row): ProductRecord => ({
  ...row,
  currency: row.currency as CurrencyCode,
  costPrice: num(row.costPrice),
  cashPrice: num(row.cashPrice),
  transferPrice: num(row.transferPrice),
  lowStockThreshold: num(row.lowStockThreshold),
  archivedAt: toDate(row.archivedAt),
  createdAt: toDate(row.createdAt),
  updatedAt: toDate(row.updatedAt),
});
const toPriced = (row: PricedRow): ProductPriceRecord => ({
  ...toRecord(row),
  cashPriceOverride: num(row.cashPriceOverride),
  transferPriceOverride: num(row.transferPriceOverride),
});

/** Column of each updatable field, in the order they are written. */
const UPDATABLE: readonly (readonly [keyof ProductChanges, string])[] = [
  ['name', 'name'],
  ['unitOfMeasure', 'unit_of_measure'],
  ['category', 'category'],
  ['currency', 'currency'],
  ['costPrice', 'cost_price'],
  ['cashPrice', 'cash_price'],
  ['transferPrice', 'transfer_price'],
  ['lowStockThreshold', 'low_stock_threshold'],
  ['expirationDate', 'expiration_date'],
];

export class ProductsRepository implements ProductRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async list(page: PageRequest & ProductFilter): Promise<Paginated<ProductPriceRecord>> {
    const after = decodeCursor(page.cursor, ['text', 'uuid']);
    const found = await rows<PricedRow>(
      this.tx,
      sql`select ${columns('p')}, lp.cash_price_override as "cashPriceOverride", lp.transfer_price_override as "transferPriceOverride"
          from products p
          left join location_products lp
            on lp.tenant_id = p.tenant_id and lp.product_id = p.id and lp.location_id = ${page.locationId ?? null}::uuid
          where (${page.q ?? null}::text is null or position(lower(${page.q ?? null}::text) in lower(p.name)) > 0)
            and (${page.category ?? null}::text is null or p.category = ${page.category ?? null}::text)
            and (${page.includeArchived} or p.archived_at is null)
            and (${after?.[0] ?? null}::text is null or (p.name, p.id) > (${after?.[0] ?? null}::text, ${after?.[1] ?? null}::uuid))
          order by p.name, p.id limit ${page.limit + 1}`,
    );
    return toPage(found.map(toPriced), page.limit, (last) => [last.name, last.id]);
  }

  async findById(id: string, locationId?: string): Promise<ProductPriceRecord | null> {
    const [row] = await rows<PricedRow>(
      this.tx,
      sql`select ${columns('p')}, lp.cash_price_override as "cashPriceOverride", lp.transfer_price_override as "transferPriceOverride"
          from products p
          left join location_products lp
            on lp.tenant_id = p.tenant_id and lp.product_id = p.id and lp.location_id = ${locationId ?? null}::uuid
          where p.id = ${id}`,
    );
    return row ? toPriced(row) : null;
  }

  async create(input: NewProduct & { readonly now: Date }): Promise<ProductRecord> {
    const [row] = await rows<Row>(
      this.tx,
      sql`insert into products (id, tenant_id, name, unit_of_measure, category, currency, cost_price, cash_price, transfer_price,
                                low_stock_threshold, expiration_date, created_at, updated_at)
          values (${uuidv7(input.now.getTime())}, ${this.tenantId}, ${input.name}, ${input.unitOfMeasure}, ${input.category ?? null},
                  ${input.currency}, ${input.costPrice ?? null}, ${input.cashPrice ?? null}, ${input.transferPrice ?? null},
                  ${input.lowStockThreshold ?? null}, ${input.expirationDate ?? null}, ${input.now}, ${input.now})
          returning ${columns()}`,
    );
    return toRecord(row!);
  }

  async lockForUpdate(id: string): Promise<ProductRecord | null> {
    const [row] = await rows<Row>(this.tx, sql`select ${columns()} from products where id = ${id} for update`);
    return row ? toRecord(row) : null;
  }

  async lockForShare(id: string): Promise<ProductRecord | null> {
    const [row] = await rows<Row>(this.tx, sql`select ${columns()} from products where id = ${id} for share`);
    return row ? toRecord(row) : null;
  }

  async update(id: string, changes: ProductChanges, now: Date): Promise<ProductRecord> {
    const sets: SQL[] = [sql`updated_at = ${now}`];
    for (const [field, column] of UPDATABLE) {
      if (changes[field] !== undefined) sets.push(sql`${sql.raw(column)} = ${changes[field]}`);
    }
    const [row] = await rows<Row>(this.tx, sql`update products set ${sql.join(sets, sql`, `)} where id = ${id} returning ${columns()}`);
    return toRecord(row!);
  }

  async archive(id: string, now: Date): Promise<ProductRecord | null> {
    const [row] = await rows<Row>(
      this.tx,
      sql`update products set archived_at = coalesce(archived_at, ${now}), updated_at = ${now} where id = ${id} returning ${columns()}`,
    );
    return row ? toRecord(row) : null;
  }

  async hasMovements(id: string): Promise<boolean> {
    const found = await rows<{ one: number }>(this.tx, sql`select 1 as one from inventory_movements where product_id = ${id} limit 1`);
    return found.length > 0;
  }

  async hasPriceOverrides(id: string): Promise<boolean> {
    const found = await rows<{ one: number }>(
      this.tx,
      sql`select 1 as one from location_products
            where product_id = ${id} and (cash_price_override is not null or transfer_price_override is not null)
            limit 1`,
    );
    return found.length > 0;
  }
}
