import type { Pool } from 'pg';

import type { SeededTenant } from './admin-fixtures';
import { insertProduct } from './inventory-fixtures';
import type { SalesFixtures } from './sales-fixtures';

const SALES = 80_000;
const PRODUCTS = 40;
const DAYS = 90;

/** ≈ 200 000 lines: 80 000 sales of 1–4 lines (mean 2.5), plus weekly entries, losses and 1% reversed sales. */
export async function seedReportVolume(admin: Pool, fx: SalesFixtures, tenant: SeededTenant): Promise<number> {
  const products: string[] = [];
  for (let i = 0; i < PRODUCTS; i++) products.push(await insertProduct(admin, tenant.id, `Producto ${String(i).padStart(2, '0')}`));
  const [l1, l2] = tenant.locations;
  await fx.inTenant(tenant.id, async (c) => {
    const params = [tenant.id, products, [l1, l2], tenant.owner, SALES, DAYS];
    await c.query(
      `insert into location_products (tenant_id, location_id, product_id, average_cost)
       select $1, l, p, 50 + (row_number() over ()) from unnest($3::uuid[]) l cross join unnest($2::uuid[]) p`,
      params.slice(0, 3),
    );
    // Weekly entries per pair, big enough that no sale drives the stock negative.
    await c.query(
      `create temp table entry_docs on commit drop as
       select gen_random_uuid() as id, l as location_id, p as product_id,
              now() - (w * interval '7 days') - interval '1 hour' as occurred_at
       from unnest($1::uuid[]) l cross join unnest($2::uuid[]) p cross join generate_series(0, 13) w`,
      [[l1, l2], products],
    );
    await c.query(
      `insert into inventory_documents (id, tenant_id, kind, location_id, occurred_at, payload_hash, created_by)
       select id, $1, 'entry', location_id, occurred_at, 'perf', $2 from entry_docs`,
      [tenant.id, tenant.owner],
    );
    await c.query(
      `insert into inventory_movements (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost)
       select gen_random_uuid(), $1, id, location_id, product_id, 'entry', 1000, 60 from entry_docs`,
      [tenant.id],
    );
    // Sales spread over the last DAYS days, up to now.
    await c.query(
      `create temp table perf_sales on commit drop as
       select gen_random_uuid() as id, ($2::uuid[])[1 + (n % 2)] as location_id,
              now() - random() * ($3 || ' days')::interval as occurred_at, 1 + floor(random() * 4)::int as lines
       from generate_series(1, $1::int) n`,
      [SALES, [l1, l2], DAYS],
    );
    await c.query(
      `insert into inventory_documents (id, tenant_id, kind, location_id, occurred_at, payload_hash, created_by)
       select id, $1, 'sale', location_id, occurred_at, 'perf', $2 from perf_sales`,
      [tenant.id, tenant.owner],
    );
    await c.query(
      `insert into sales (id, tenant_id, location_id, cashier_user_id, occurred_at, payload_hash)
       select id, $1, location_id, $2, occurred_at, 'perf' from perf_sales`,
      [tenant.id, tenant.owner],
    );
    await c.query(
      `create temp table perf_lines on commit drop as
       select gen_random_uuid() as id, s.id as sale_id, s.location_id, s.occurred_at,
              ($1::uuid[])[1 + floor(random() * ${PRODUCTS})::int] as product_id,
              1 + floor(random() * 3)::int as quantity, 100 + floor(random() * 900)::int as unit_price,
              case when random() < 0.5 then 'cash' else 'transfer' end as payment_method
       from perf_sales s cross join lateral generate_series(1, s.lines) g`,
      [products],
    );
    await c.query(
      `insert into sale_lines (id, tenant_id, sale_id, location_id, product_id, occurred_at, cashier_user_id, currency, quantity,
                               unit_price, discount_percent, payment_method, is_cost_sale, unit_cost, line_total, profit)
       select id, $1, sale_id, location_id, product_id, occurred_at, $2, 'CUP', quantity, unit_price, 0, payment_method, false, 60,
              quantity * unit_price, quantity * unit_price - quantity * 60
       from perf_lines`,
      [tenant.id, tenant.owner],
    );
    await c.query(
      `insert into inventory_movements (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost)
       select gen_random_uuid(), $1, sale_id, location_id, product_id, 'sale', -quantity, 60 from perf_lines`,
      [tenant.id],
    );
    // 1% of the sales reversed, and a shrinkage per pair and week.
    await c.query(
      `insert into inventory_documents (id, tenant_id, kind, location_id, reverses_document_id, occurred_at, payload_hash, created_by)
       select gen_random_uuid(), $1, 'reversal', location_id, id, occurred_at + interval '1 minute', 'perf', $2
       from perf_sales where occurred_at < now() - interval '1 hour' order by id limit ${SALES / 100}`,
      [tenant.id, tenant.owner],
    );
    await c.query(
      `with shrink as (
         insert into inventory_documents (id, tenant_id, kind, location_id, reason, occurred_at, payload_hash, created_by)
         select gen_random_uuid(), $1, 'exit', location_id, 'shrinkage', occurred_at + interval '30 minutes', 'perf', $2 from entry_docs
         returning id, location_id
       )
       insert into inventory_movements (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost)
       select gen_random_uuid(), $1, s.id, s.location_id, ($3::uuid[])[1 + floor(random() * ${PRODUCTS})::int], 'shrinkage', -1, 60 from shrink s`,
      [tenant.id, tenant.owner, products],
    );
  });
  for (const table of ['sale_lines', 'sales', 'inventory_documents', 'inventory_movements', 'location_products', 'products']) {
    await admin.query(`vacuum (analyze) ${table}`);
  }
  const { rows } = await admin.query<{ n: number }>('select count(*)::int as n from sale_lines where tenant_id = $1', [tenant.id]);
  return rows[0]!.n;
}

