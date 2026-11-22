import type { CurrencyCode, TopProductsOrder } from '@monaco/contracts';
import { type SQL, sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type {
  DailyPointRecord,
  LocationRecord,
  PairHealthRecord,
  ReportClock,
  ReportsReader,
  SalesFilter,
  SalesTotalsRecord,
  TopProductRecord,
  ValuedMovementKind,
  ValuedQuantityRecord,
} from '../../domain/reports-ports';

/*
 * Live aggregates for the reports (ADR 0007 §3), on one `withTenant`
 * transaction: RLS stays the second barrier and every predicate also names the
 * tenant, so the indexes lead with it. Local days become a half-open
 * `timestamptz` range in SQL, `[from 00:00 local, to + 1 00:00 local)`, through
 * `AT TIME ZONE`, so the filter uses the `occurred_at` indexes and a DST change
 * neither loses nor duplicates a sale. Every read is cut at now() and skips
 * reversed documents (a `NOT EXISTS` on the unique reverses_document_id). Sums
 * are exact numerics, returned as text (node-postgres) and converted here.
 */

const uuids = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

/**
 * The instants of a filter: `[start, end)` of its local days and the cut-off now().
 * Computed in a statement of their own and bound as `timestamptz` parameters: under
 * RLS, Postgres only turns a predicate into an index condition when it is leakproof,
 * and `AT TIME ZONE` (which can raise on a bad zone) and now() are not. Inline, they
 * would make every report scan the whole location (or the table).
 */
interface Window {
  readonly start: string;
  readonly end: string;
  readonly asOf: string;
}

/** `occurred_at` inside the window and not in the future. */
function inWindow(column: SQL, window: Window): SQL {
  return sql`${column} >= ${window.start}::timestamptz and ${column} < ${window.end}::timestamptz and ${column} <= ${window.asOf}::timestamptz`;
}

const notReversed = (tenant: SQL, documentId: SQL) =>
  sql`not exists (select 1 from inventory_documents r where r.tenant_id = ${tenant} and r.reverses_document_id = ${documentId})`;

/** The `ORDER BY` of each ranking, from a closed list (never interpolated from input). */
const RANKING: Record<TopProductsOrder, SQL> = {
  revenue: sql.raw('sum(sl.line_total)'),
  quantity: sql.raw('sum(sl.quantity)'),
  profit: sql.raw('sum(sl.profit)'),
};

interface ClockRow {
  timeZone: string;
  asOf: Date | string;
  today: string;
}
interface TotalsRow {
  locationId: string | null;
  currency: CurrencyCode;
  cashSales: string;
  transferSales: string;
  profit: string;
  tickets: number;
}
interface ValuedRow {
  locationId: string;
  kind: ValuedMovementKind;
  currency: CurrencyCode;
  unitCost: string;
  quantity: string;
}
interface DailyRow {
  currency: CurrencyCode;
  date: string;
  totalSales: string;
  profit: string;
}
interface TopRow {
  productId: string;
  name: string;
  unitOfMeasure: string;
  currency: CurrencyCode;
  quantity: string;
  totalSales: string;
  profit: string;
}
type PairRow = Omit<PairHealthRecord, 'lowStockThreshold' | 'quantity' | 'averageCost'> & {
  lowStockThreshold: string | null;
  quantity: string;
  averageCost: string;
};

export class ReportsReaderRepository implements ReportsReader {
  private readonly windows = new Map<string, Promise<Window>>();

  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  /** Local days to instants in SQL (DST-exact), once per range in this transaction (same now()). */
  private window(filter: Pick<SalesFilter, 'range' | 'timeZone'>): Promise<Window> {
    const key = `${filter.range.from}|${filter.range.to}|${filter.timeZone}`;
    let window = this.windows.get(key);
    if (!window) {
      window = rows<Window>(
        this.tx,
        sql`select (${filter.range.from}::date::timestamp at time zone ${filter.timeZone})::text as start,
                   ((${filter.range.to}::date + 1)::timestamp at time zone ${filter.timeZone})::text as "end",
                   now()::text as "asOf"`,
      ).then(([row]) => row!);
      this.windows.set(key, window);
    }
    return window;
  }

  /** Zone, now() and today in that zone, in one statement so they agree. */
  async clock(): Promise<ReportClock> {
    const [row] = await rows<ClockRow>(
      this.tx,
      sql`select t.time_zone as "timeZone", now() as "asOf", (now() at time zone t.time_zone)::date::text as today
          from tenants t where t.id = ${this.tenantId}`,
    );
    // Inside withTenant the tenant row is always visible; its absence is a broken invariant.
    if (!row) throw new Error('The tenant of the unit of work is not visible');
    return { timeZone: row.timeZone, asOf: toDate(row.asOf), today: row.today };
  }

  async findLocation(id: string): Promise<LocationRecord | null> {
    const [row] = await rows<LocationRecord>(this.tx, sql`select id, name from locations where tenant_id = ${this.tenantId} and id = ${id}`);
    return row ?? null;
  }

  activeLocations(): Promise<LocationRecord[]> {
    return rows<LocationRecord>(
      this.tx,
      sql`select id, name from locations where tenant_id = ${this.tenantId} and archived_at is null order by name, id`,
    );
  }

  /** Sale lines through the covering index (tenant_id, location_id, occurred_at) INCLUDE (...). */
  private async salesWhere(filter: SalesFilter): Promise<SQL> {
    const own = filter.cashierUserId === undefined ? sql`` : sql` and sl.cashier_user_id = ${filter.cashierUserId}::uuid`;
    return sql`sl.tenant_id = ${this.tenantId} and sl.location_id = any(${uuids(filter.locationIds)})
      and ${inWindow(sql`sl.occurred_at`, await this.window(filter))}${own}
      and ${notReversed(sql`sl.tenant_id`, sql`sl.sale_id`)}`;
  }

  /**
   * Per sale first, then per (location, currency): the inner GROUP BY hashes by
   * sale, so tickets are a plain count instead of a `count(distinct)`, which
   * always sorts (and spilled to disk at 10× the demo volume).
   */
  async salesTotals(filter: SalesFilter, perLocation: boolean): Promise<SalesTotalsRecord[]> {
    const location = perLocation ? sql`sl.location_id` : sql`null::uuid`;
    const found = await rows<TotalsRow>(
      this.tx,
      sql`select "locationId", currency, sum(cash)::text as "cashSales", sum(transfer)::text as "transferSales",
                 sum(profit)::text as profit, count(*)::int as tickets
          from (
            select ${location} as "locationId", sl.currency, sl.sale_id,
                   coalesce(sum(sl.line_total) filter (where sl.payment_method = 'cash'), 0) as cash,
                   coalesce(sum(sl.line_total) filter (where sl.payment_method = 'transfer'), 0) as transfer,
                   sum(sl.profit) as profit
            from sale_lines sl
            where ${await this.salesWhere(filter)}
            group by 1, 2, 3
          ) per_sale
          group by 1, 2 order by 1, 2`,
    );
    return found.map((row) => ({
      ...row,
      cashSales: Number(row.cashSales),
      transferSales: Number(row.transferSales),
      profit: Number(row.profit),
    }));
  }

  /**
   * Σ |quantity_delta| per (location, kind, currency, unit cost) of exits and
   * entries, through the partial index on documents (kind in ('exit', 'entry'))
   * and, per document, the movements' (tenant_id, document_id) index. Grouping by unit cost
   * keeps `costValue`/`lossValue` exact in the use case: Σ|q|·c = Σ_c c·Σ|q|.
   */
  async valuedMovements(filter: SalesFilter): Promise<ValuedQuantityRecord[]> {
    const found = await rows<ValuedRow>(
      this.tx,
      sql`select d.location_id as "locationId", m.kind, p.currency, m.unit_cost::text as "unitCost",
                 sum(abs(m.quantity_delta))::text as quantity
          from inventory_documents d
          cross join lateral (
            select m.kind, m.product_id, m.unit_cost, m.quantity_delta from inventory_movements m
            where m.tenant_id = d.tenant_id and m.document_id = d.id and m.kind in ('shrinkage', 'owner_withdrawal', 'entry')
            -- A fence: the movements of the documents in range are probed by (tenant_id, document_id),
            -- never hashed from a scan of the whole ledger, whose size is mostly sale movements.
            offset 0
          ) m
          join products p on p.tenant_id = d.tenant_id and p.id = m.product_id
          where d.tenant_id = ${this.tenantId} and d.kind in ('exit', 'entry')
            and d.location_id = any(${uuids(filter.locationIds)})
            and ${inWindow(sql`d.occurred_at`, await this.window(filter))}
            and ${notReversed(sql`d.tenant_id`, sql`d.id`)}
          group by 1, 2, 3, 4 order by 1, 2, 3, 4`,
    );
    return found.map((row) => ({ ...row, unitCost: Number(row.unitCost), quantity: Number(row.quantity) }));
  }

  /** Every local day of the range for each currency with sales in it (missing days are 0). */
  async dailySales(filter: SalesFilter): Promise<DailyPointRecord[]> {
    const found = await rows<DailyRow>(
      this.tx,
      sql`with agg as (
            select (sl.occurred_at at time zone ${filter.timeZone})::date as day, sl.currency,
                   sum(sl.line_total) as total, sum(sl.profit) as profit
            from sale_lines sl
            where ${await this.salesWhere(filter)}
            group by 1, 2
          )
          select c.currency, d.day::date::text as date,
                 coalesce(a.total, 0)::text as "totalSales", coalesce(a.profit, 0)::text as profit
          from (select distinct currency from agg) c
          cross join generate_series(${filter.range.from}::date, ${filter.range.to}::date, interval '1 day') as d(day)
          left join agg a on a.currency = c.currency and a.day = d.day::date
          order by c.currency, d.day`,
    );
    return found.map((row) => ({ ...row, totalSales: Number(row.totalSales), profit: Number(row.profit) }));
  }

  async topProducts(filter: SalesFilter, by: TopProductsOrder, limit: number): Promise<TopProductRecord[]> {
    const found = await rows<TopRow>(
      this.tx,
      sql`select sl.product_id as "productId", p.name, p.unit_of_measure as "unitOfMeasure", sl.currency,
                 sum(sl.quantity)::text as quantity, sum(sl.line_total)::text as "totalSales", sum(sl.profit)::text as profit
          from sale_lines sl
          join products p on p.tenant_id = sl.tenant_id and p.id = sl.product_id
          where ${await this.salesWhere(filter)}
          group by sl.product_id, p.name, p.unit_of_measure, sl.currency
          order by ${RANKING[by]} desc, p.name, sl.product_id
          limit ${limit}`,
    );
    return found.map((row) => ({ ...row, quantity: Number(row.quantity), totalSales: Number(row.totalSales), profit: Number(row.profit) }));
  }

  /**
   * Every (location, product) of the given locations, at the moment: stock by the
   * covering index (tenant_id, location_id, product_id) INCLUDE (quantity_delta),
   * and the last non-reversed sale by (tenant_id, location_id, product_id,
   * occurred_at) read backwards. Archived products only while they hold stock.
   */
  async pairHealth(locationIds: readonly string[], timeZone: string): Promise<PairHealthRecord[]> {
    const [{ asOf }] = (await rows<{ asOf: string }>(this.tx, sql`select now()::text as "asOf"`)) as [{ asOf: string }];
    const found = await rows<PairRow>(
      this.tx,
      sql`select l.id as "locationId", p.id as "productId", p.name, p.unit_of_measure as "unitOfMeasure", p.category, p.currency,
                 p.low_stock_threshold::text as "lowStockThreshold", p.expiration_date::text as "expirationDate",
                 p.archived_at is not null as archived,
                 coalesce(s.quantity, 0)::text as quantity, coalesce(lp.average_cost, 0)::text as "averageCost",
                 ls.day as "lastSaleDate"
          from locations l
          join products p on p.tenant_id = l.tenant_id
          left join location_products lp on lp.tenant_id = l.tenant_id and lp.location_id = l.id and lp.product_id = p.id
          left join lateral (
            select sum(m.quantity_delta) as quantity from inventory_movements m
            where m.tenant_id = l.tenant_id and m.location_id = l.id and m.product_id = p.id
          ) s on true
          left join lateral (
            select (sl.occurred_at at time zone ${timeZone})::date::text as day from sale_lines sl
            where sl.tenant_id = l.tenant_id and sl.location_id = l.id and sl.product_id = p.id and sl.occurred_at <= ${asOf}::timestamptz
              and ${notReversed(sql`sl.tenant_id`, sql`sl.sale_id`)}
            order by sl.occurred_at desc limit 1
          ) ls on true
          where l.tenant_id = ${this.tenantId} and l.id = any(${uuids(locationIds)})
            and (p.archived_at is null or coalesce(s.quantity, 0) <> 0)
          order by p.name, p.id, l.id`,
    );
    return found.map((row) => ({
      ...row,
      lowStockThreshold: row.lowStockThreshold === null ? null : Number(row.lowStockThreshold),
      quantity: Number(row.quantity),
      averageCost: Number(row.averageCost),
    }));
  }
}
