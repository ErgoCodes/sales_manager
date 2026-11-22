import type { Pool } from 'pg';

/** Pairs (location, product) whose stock is under zero. Empty means the seed respected the ledger. */
export async function negativeStockPairs(admin: Pool): Promise<{ location_id: string; product_id: string; stock: string }[]> {
  const { rows } = await admin.query(
    `select location_id, product_id, sum(quantity_delta)::text as stock
       from inventory_movements group by location_id, product_id having sum(quantity_delta) < 0`,
  );
  return rows;
}

/**
 * Sales per local business day of each tenant's zone (`[00:00, 24:00)` local, D3), over the last
 * `days` local days, today included and in full (not cut at now()). The reports API is T6; this is
 * the same grouping on `sale_lines`.
 */
export async function salesByLocalDay(admin: Pool, days: number): Promise<{ day: string; locations: number; lines: number; total: number }[]> {
  const { rows } = await admin.query(
    `select (sl.occurred_at at time zone t.time_zone)::date::text as day,
            count(distinct sl.location_id)::int as locations, count(*)::int as lines, sum(sl.line_total)::float8 as total
       from sale_lines sl join tenants t on t.id = sl.tenant_id
      where (sl.occurred_at at time zone t.time_zone)::date > (now() at time zone t.time_zone)::date - $1::int
        and (sl.occurred_at at time zone t.time_zone)::date <= (now() at time zone t.time_zone)::date
      group by 1 order by 1`,
    [days],
  );
  return rows;
}

/** Total sold over the last `days` local days, cut at now() as the KPIs are (D14). */
export async function salesTotal(admin: Pool, days: number): Promise<number> {
  const { rows } = await admin.query(
    `select coalesce(sum(sl.line_total), 0)::float8 as total
       from sale_lines sl join tenants t on t.id = sl.tenant_id
      where sl.occurred_at >= (((now() at time zone t.time_zone)::date - ($1::int - 1)) at time zone t.time_zone)
        and sl.occurred_at < now()`,
    [days],
  );
  return rows[0].total;
}
