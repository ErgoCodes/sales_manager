import { CURRENCIES } from '@monaco/contracts';
import { PAYMENT_METHODS } from '@monaco/domain';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { adminPool, resetTenants, seedTenants, TENANT_A, TENANT_B, urls } from './helpers';

// SP4 · T4: sales and sale_lines (spec "Ventas en el servidor"), tenants.time_zone and tenants.read_only.
let admin: Pool;
let app: Pool;
beforeAll(() => {
  admin = adminPool();
  app = new Pool({ connectionString: urls().app, max: 1 });
});
afterAll(async () => {
  await admin.end();
  await app.end();
});

const ids = {
  locA: uuidv7(),
  locA2: uuidv7(),
  locB: uuidv7(),
  userA: uuidv7(),
  userB: uuidv7(),
  deviceA: uuidv7(),
  deviceB: uuidv7(),
  prodA: uuidv7(),
  prodB: uuidv7(),
};

/** Postgres code and constraint of a failed statement, for "same error as a missing id" comparisons. */
async function failure(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { code?: string; constraint?: string; message?: string } | undefined;
  if (!error) throw new Error('Expected the statement to fail, but it succeeded');
  return { code: error.code, constraint: error.constraint, message: error.message };
}

function insertRow(pool: Pool, table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  return pool.query(
    `insert into ${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
}

/** A `sale` inventory document of tenant A in location A (its id is the sale's id). */
async function saleDocument(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  await insertRow(admin, 'inventory_documents', {
    id,
    tenant_id: TENANT_A,
    kind: 'sale',
    location_id: ids.locA,
    occurred_at: new Date(),
    payload_hash: 'h',
    created_by: ids.userA,
    ...overrides,
  });
  return id;
}

const sale = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  tenant_id: TENANT_A,
  location_id: ids.locA,
  cashier_user_id: ids.userA,
  device_id: null,
  occurred_at: new Date(),
  payload_hash: 'h',
  ...overrides,
});

const line = (saleId: string, overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  tenant_id: TENANT_A,
  sale_id: saleId,
  location_id: ids.locA,
  product_id: ids.prodA,
  occurred_at: new Date(),
  cashier_user_id: ids.userA,
  currency: 'CUP',
  quantity: '2',
  unit_price: 1500,
  discount_percent: '0',
  payment_method: 'cash',
  is_cost_sale: false,
  unit_cost: '1000.5',
  line_total: 3000,
  profit: '999',
  ...overrides,
});

/** A sale header of tenant A with its document; returns its id. */
async function ownSale(): Promise<string> {
  const id = await saleDocument();
  await insertRow(admin, 'sales', sale(id));
  return id;
}

beforeEach(async () => {
  await resetTenants(admin);
  await seedTenants(admin);
  await admin.query(
    `insert into locations (id, tenant_id, name, code) values ($1, $4, 'A1', 'a1'), ($2, $4, 'A2', 'a2'), ($3, $5, 'B1', 'b1')`,
    [ids.locA, ids.locA2, ids.locB, TENANT_A, TENANT_B],
  );
  await admin.query(
    `insert into users (id, tenant_id, email, display_name, password_hash) values ($1, $3, 'ua@x.test', 'UA', 'x'), ($2, $4, 'ub@x.test', 'UB', 'x')`,
    [ids.userA, ids.userB, TENANT_A, TENANT_B],
  );
  await admin.query(
    `insert into devices (id, tenant_id, user_id, label, platform) values ($1, $3, $4, 'd', 'web'), ($2, $5, $6, 'd', 'web')`,
    [ids.deviceA, ids.deviceB, TENANT_A, ids.userA, TENANT_B, ids.userB],
  );
  await admin.query(
    `insert into products (id, tenant_id, name, unit_of_measure, currency) values ($1, $3, 'PA', 'ud', 'CUP'), ($2, $4, 'PB', 'kg', 'USD')`,
    [ids.prodA, ids.prodB, TENANT_A, TENANT_B],
  );
  await admin.query(
    `insert into location_products (tenant_id, location_id, product_id) values ($1, $2, $3), ($4, $5, $6)`,
    [TENANT_A, ids.locA, ids.prodA, TENANT_B, ids.locB, ids.prodB],
  );
});

describe('sales and sale_lines: composite FKs keep every reference inside the tenant', () => {
  it('a sale needs an inventory document of its own tenant, with the error of a missing one', async () => {
    const foreignDoc = await saleDocument({ tenant_id: TENANT_B, location_id: ids.locB, created_by: ids.userB });
    const crossTenant = await failure(insertRow(admin, 'sales', sale(foreignDoc)));
    const missing = await failure(insertRow(admin, 'sales', sale(uuidv7())));
    expect(crossTenant).toMatchObject({ code: '23503', constraint: 'sales_document_fk' });
    expect({ code: missing.code, constraint: missing.constraint }).toEqual({ code: crossTenant.code, constraint: crossTenant.constraint });
  });

  it('a sale rejects a foreign location, cashier or device', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ location_id: ids.locB }, 'sales_location_fk'],
      [{ cashier_user_id: ids.userB }, 'sales_cashier_user_fk'],
      [{ device_id: ids.deviceB }, 'sales_device_fk'],
    ];
    for (const [overrides, constraint] of cases) {
      expect(await failure(insertRow(admin, 'sales', sale(await saleDocument(), overrides))), constraint).toMatchObject({ code: '23503', constraint });
    }
    await insertRow(admin, 'sales', sale(await saleDocument(), { device_id: ids.deviceA }));
  });

  it('a sale line needs a sale and a (location, product) pair of its own tenant', async () => {
    const own = await ownSale();
    const foreignSale = await saleDocument({ tenant_id: TENANT_B, location_id: ids.locB, created_by: ids.userB });
    await insertRow(admin, 'sales', sale(foreignSale, { tenant_id: TENANT_B, location_id: ids.locB, cashier_user_id: ids.userB }));
    const crossTenant = await failure(insertRow(admin, 'sale_lines', line(foreignSale)));
    const missing = await failure(insertRow(admin, 'sale_lines', line(uuidv7())));
    expect(crossTenant).toMatchObject({ code: '23503', constraint: 'sale_lines_sale_fk' });
    expect({ code: missing.code, constraint: missing.constraint }).toEqual({ code: crossTenant.code, constraint: crossTenant.constraint });
    // A pair without location_products (product B in location A, or product A in location A2).
    for (const overrides of [{ product_id: ids.prodB }, { location_id: ids.locA2 }, { location_id: ids.locB }]) {
      expect(await failure(insertRow(admin, 'sale_lines', line(own, overrides))), JSON.stringify(overrides)).toMatchObject({
        code: '23503',
        constraint: 'sale_lines_location_product_fk',
      });
    }
    await insertRow(admin, 'sale_lines', line(own));
  });
});

describe('sale_lines CHECKs reject impossible amounts', () => {
  it('rejects a non-positive quantity, negative amounts, a discount outside 0–100 and unknown catalogs', async () => {
    const own = await ownSale();
    const bad: [Record<string, unknown>, string][] = [
      [{ quantity: '0' }, 'sale_lines_quantity_check'],
      [{ quantity: '-1' }, 'sale_lines_quantity_check'],
      [{ unit_price: -1 }, 'sale_lines_unit_price_check'],
      [{ unit_cost: '-0.000001' }, 'sale_lines_unit_cost_check'],
      [{ line_total: -1 }, 'sale_lines_line_total_check'],
      [{ discount_percent: '-0.01' }, 'sale_lines_discount_percent_check'],
      [{ discount_percent: '100.01' }, 'sale_lines_discount_percent_check'],
      [{ payment_method: 'efectivo' }, 'sale_lines_payment_method_check'],
      [{ payment_method: 'card' }, 'sale_lines_payment_method_check'],
      [{ currency: 'EUR' }, 'sale_lines_currency_check'],
    ];
    for (const [overrides, constraint] of bad) {
      expect(await failure(insertRow(admin, 'sale_lines', line(own, overrides))), JSON.stringify(overrides)).toMatchObject({ code: '23514', constraint });
    }
    // Bounds are inclusive; a sale below cost has a negative profit.
    await insertRow(admin, 'sale_lines', line(own, { discount_percent: '100', unit_price: 0, line_total: 0, profit: '-2001', quantity: '0.001' }));
    await insertRow(admin, 'sale_lines', line(own, { discount_percent: '0', is_cost_sale: true, payment_method: 'transfer' }));
  });

  it('the payment method and currency CHECKs list exactly the shared catalogs', async () => {
    const values = async (name: string) => {
      const { rows } = await admin.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`, [name]);
      expect(rows, name).toHaveLength(1);
      return [...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((match) => match[1]!).sort();
    };
    expect(await values('sale_lines_payment_method_check')).toEqual([...PAYMENT_METHODS].sort());
    expect(await values('sale_lines_currency_check')).toEqual([...CURRENCIES].sort());
  });
});

describe('monaco_app on sales and sale_lines', () => {
  const inTenant = async <T>(tenant: string, work: (client: import('pg').PoolClient) => Promise<T>): Promise<T> => {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
      return await work(client);
    } finally {
      await client.query('rollback');
      client.release();
    }
  };

  it('is append-only: can INSERT and SELECT but never UPDATE, DELETE or TRUNCATE', async () => {
    const own = await ownSale();
    await insertRow(admin, 'sale_lines', line(own));
    await inTenant(TENANT_A, async (client) => {
      const id = uuidv7();
      await client.query(
        `insert into inventory_documents (id, tenant_id, kind, location_id, occurred_at, payload_hash, created_by) values ($1, $2, 'sale', $3, now(), 'h', $4)`,
        [id, TENANT_A, ids.locA, ids.userA],
      );
      await client.query(
        `insert into sales (id, tenant_id, location_id, cashier_user_id, occurred_at, payload_hash) values ($1, $2, $3, $4, now(), 'h')`,
        [id, TENANT_A, ids.locA, ids.userA],
      );
      expect((await client.query('select 1 from sales')).rowCount).toBe(2);
      expect((await client.query('select 1 from sale_lines')).rowCount).toBe(1);
    });
    for (const statement of [
      'update sales set payload_hash = null',
      'delete from sales',
      'truncate table sales',
      'update sale_lines set line_total = 0',
      'delete from sale_lines',
      'truncate table sale_lines',
    ]) {
      await expect(app.query(statement), statement).rejects.toThrow(/permission denied/i);
    }
  });

  it('is bound by RLS (FORCE): sees nothing without a tenant, nothing of another tenant, and cannot insert for another one', async () => {
    const own = await ownSale();
    await insertRow(admin, 'sale_lines', line(own));
    expect((await app.query('select 1 from sales')).rowCount).toBe(0);
    expect((await app.query('select 1 from sale_lines')).rowCount).toBe(0);
    await inTenant(TENANT_B, async (client) => {
      expect((await client.query('select 1 from sales')).rowCount).toBe(0);
      expect((await client.query('select 1 from sale_lines')).rowCount).toBe(0);
      await expect(client.query(`insert into sale_lines (id, tenant_id, sale_id, location_id, product_id, occurred_at, cashier_user_id, currency, quantity, unit_price, discount_percent, payment_method, is_cost_sale, unit_cost, line_total, profit)
        values ($1, $2, $3, $4, $5, now(), $6, 'CUP', 1, 1, 0, 'cash', false, 0, 1, 1)`, [uuidv7(), TENANT_A, own, ids.locA, ids.prodA, ids.userA])).rejects.toThrow(/row-level security/i);
    });
  });
});

describe('tenants.time_zone and tenants.read_only (SP4 · D3, D10)', () => {
  it('default to America/Havana and false', async () => {
    expect((await admin.query('select time_zone, read_only from tenants where id = $1', [TENANT_A])).rows).toEqual([
      { time_zone: 'America/Havana', read_only: false },
    ]);
  });

  it('monaco_app cannot change either of them (UPDATE stays limited to name)', async () => {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      await client.query('savepoint s');
      await expect(client.query(`update tenants set time_zone = 'UTC' where id = $1`, [TENANT_A])).rejects.toThrow(/permission denied/i);
      await client.query('rollback to savepoint s');
      await expect(client.query(`update tenants set read_only = true where id = $1`, [TENANT_A])).rejects.toThrow(/permission denied/i);
      await client.query('rollback to savepoint s');
      // It still reads both, and still renames its tenant.
      expect((await client.query('select time_zone, read_only from tenants')).rows).toEqual([{ time_zone: 'America/Havana', read_only: false }]);
      expect((await client.query(`update tenants set name = 'Renamed' where id = $1`, [TENANT_A])).rowCount).toBe(1);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('a stored alias the runtime ICU does not list (Europe/Kyiv) reads fine, and Postgres resolves it', async () => {
    await admin.query(`update tenants set time_zone = 'Europe/Kyiv' where id = $1`, [TENANT_A]);
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      const { rows } = await client.query(`select time_zone, (timestamptz '2026-07-01 00:00:00Z' at time zone time_zone)::text as local from tenants`);
      expect(rows).toEqual([{ time_zone: 'Europe/Kyiv', local: '2026-07-01 03:00:00' }]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('report indexes (spec "Consultas e índices")', () => {
  const definition = async (name: string) =>
    (await admin.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = $1`, [name])).rows[0]?.def;

  it('sale_lines has the covering KPI index and the product index', async () => {
    expect(await definition('sale_lines_kpi_idx')).toContain(
      '(tenant_id, location_id, occurred_at) INCLUDE (currency, payment_method, line_total, profit, sale_id)',
    );
    expect(await definition('sale_lines_tenant_id_location_id_product_id_occurred_at_idx')).toContain(
      '(tenant_id, location_id, product_id, occurred_at)',
    );
  });

  it('inventory_documents has the partial index of exits and entries', async () => {
    const def = await definition('inventory_documents_tenant_id_location_id_occurred_at_idx');
    expect(def).toContain('(tenant_id, location_id, occurred_at)');
    expect(def).toMatch(/WHERE \(kind = ANY \(ARRAY\['exit'::text, 'entry'::text\]\)\)/);
  });
});
