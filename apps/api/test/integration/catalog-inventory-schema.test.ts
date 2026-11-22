import { CATEGORIES, INVENTORY_MOVEMENT_KINDS, UNITS_OF_MEASURE } from '@monaco/domain';
import { EXIT_REASONS, INVENTORY_DOCUMENT_KINDS, MAX_NOTES_LENGTH } from '@monaco/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { adminPool, resetTenants, seedTenants, TENANT_A, TENANT_B, urls } from './helpers';
import { movementsOutsideDocumentLocations } from './inventory-invariants';

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

/** The string literals of a CHECK, in any order. */
async function checkValues(name: string): Promise<string[]> {
  const { rows } = await admin.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`, [name]);
  expect(rows, name).toHaveLength(1);
  return [...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((match) => match[1]!).sort();
}

describe('catalog and inventory CHECKs are generated from the shared catalogs', () => {
  it.each([
    ['products_unit_of_measure_check', UNITS_OF_MEASURE.map((unit) => unit.value)],
    ['products_category_check', CATEGORIES],
    ['products_currency_check', ['CUP', 'USD', 'MLC']],
    ['inventory_movements_kind_check', INVENTORY_MOVEMENT_KINDS],
    ['inventory_documents_kind_check', INVENTORY_DOCUMENT_KINDS],
    ['inventory_documents_reason_check', EXIT_REASONS],
  ])('%s lists exactly its catalog', async (name, catalog) => {
    // Changing a catalog without a migration fails here.
    expect(await checkValues(name)).toEqual([...catalog].sort());
  });
});

// One product and one location per tenant, a user, and a location_products row per pair.
const ids = {
  locA: uuidv7(),
  locA2: uuidv7(),
  locB: uuidv7(),
  userA: uuidv7(),
  userB: uuidv7(),
  prodA: uuidv7(),
  prodB: uuidv7(),
};
const doc = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  tenant_id: TENANT_A,
  kind: 'entry',
  location_id: ids.locA,
  target_location_id: null,
  reason: null,
  reverses_document_id: null,
  occurred_at: new Date(),
  notes: null,
  payload_hash: 'h',
  created_by: ids.userA,
  ...overrides,
});
const COLS = ['id', 'tenant_id', 'kind', 'location_id', 'target_location_id', 'reason', 'reverses_document_id', 'occurred_at', 'notes', 'payload_hash', 'created_by'];
async function insertDoc(pool: Pool, row: ReturnType<typeof doc>) {
  await pool.query(`insert into inventory_documents (${COLS.join(', ')}) values (${COLS.map((_, i) => `$${i + 1}`).join(', ')})`, COLS.map((c) => (row as Record<string, unknown>)[c]));
}
const mov = (documentId: string, overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  tenant_id: TENANT_A,
  document_id: documentId,
  location_id: ids.locA,
  product_id: ids.prodA,
  kind: 'entry',
  quantity_delta: '5',
  unit_cost: '100',
  reverses_movement_id: null,
  ...overrides,
});
const MCOLS = ['id', 'tenant_id', 'document_id', 'location_id', 'product_id', 'kind', 'quantity_delta', 'unit_cost', 'reverses_movement_id'];
async function insertMov(pool: Pool, row: ReturnType<typeof mov>) {
  await pool.query(`insert into inventory_movements (${MCOLS.join(', ')}) values (${MCOLS.map((_, i) => `$${i + 1}`).join(', ')})`, MCOLS.map((c) => (row as Record<string, unknown>)[c]));
}
/** Postgres code and constraint of a failed statement, for "same error as a missing id" comparisons. */
async function failure(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { code?: string; constraint?: string; message?: string } | undefined;
  if (!error) throw new Error('Expected the statement to fail, but it succeeded');
  return { code: error.code, constraint: error.constraint, message: error.message };
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
    `insert into products (id, tenant_id, name, unit_of_measure, currency) values ($1, $3, 'PA', 'ud', 'CUP'), ($2, $4, 'PB', 'kg', 'USD')`,
    [ids.prodA, ids.prodB, TENANT_A, TENANT_B],
  );
  await admin.query(
    `insert into location_products (tenant_id, location_id, product_id) values ($1, $2, $3), ($1, $4, $3), ($5, $6, $7)`,
    [TENANT_A, ids.locA, ids.prodA, ids.locA2, TENANT_B, ids.locB, ids.prodB],
  );
});

describe('composite FKs keep every reference inside the tenant', () => {
  it('location_products rejects a foreign location or product with the error of a missing id', async () => {
    const insert = (location: string, product: string) =>
      admin.query(`insert into location_products (tenant_id, location_id, product_id) values ($1, $2, $3)`, [TENANT_A, location, product]);
    const missing = uuidv7();
    expect(await failure(insert(ids.locB, ids.prodA))).toMatchObject({ code: '23503', constraint: 'location_products_location_fk' });
    expect(await failure(insert(missing, ids.prodA))).toMatchObject({ code: '23503', constraint: 'location_products_location_fk' });
    expect(await failure(insert(ids.locA2, ids.prodB))).toMatchObject({ code: '23503', constraint: 'location_products_product_fk' });
    expect(await failure(insert(ids.locA2, missing))).toMatchObject({ code: '23503', constraint: 'location_products_product_fk' });
  });

  it('inventory_documents rejects a foreign location, target, author or reversed document', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ location_id: ids.locB }, 'inventory_documents_location_fk'],
      [{ kind: 'transfer', target_location_id: ids.locB }, 'inventory_documents_target_location_fk'],
      [{ created_by: ids.userB }, 'inventory_documents_created_by_fk'],
    ];
    for (const [overrides, constraint] of cases) {
      expect(await failure(insertDoc(admin, doc(overrides)))).toMatchObject({ code: '23503', constraint });
    }
    // A document of tenant B to reverse, and a missing one: same error.
    const foreign = doc({ tenant_id: TENANT_B, location_id: ids.locB, created_by: ids.userB });
    await insertDoc(admin, foreign);
    const asReversal = (id: string) => doc({ kind: 'reversal', reverses_document_id: id });
    const crossTenant = await failure(insertDoc(admin, asReversal(foreign.id)));
    const missing = await failure(insertDoc(admin, asReversal(uuidv7())));
    expect(crossTenant).toMatchObject({ code: '23503', constraint: 'inventory_documents_reverses_fk' });
    expect(crossTenant).toEqual(missing);
  });

  it('inventory_movements rejects a foreign document, product, location or reversed movement', async () => {
    const own = doc();
    await insertDoc(admin, own);
    const foreignDoc = doc({ tenant_id: TENANT_B, location_id: ids.locB, created_by: ids.userB });
    await insertDoc(admin, foreignDoc);
    const crossTenantDoc = await failure(insertMov(admin, mov(foreignDoc.id)));
    const missingDoc = await failure(insertMov(admin, mov(uuidv7())));
    expect(crossTenantDoc).toMatchObject({ code: '23503', constraint: 'inventory_movements_document_fk' });
    expect(crossTenantDoc).toEqual(missingDoc);
    // The (location, product) pair must exist in location_products of the same tenant.
    expect(await failure(insertMov(admin, mov(own.id, { product_id: ids.prodB })))).toMatchObject({ code: '23503', constraint: 'inventory_movements_location_product_fk' });
    expect(await failure(insertMov(admin, mov(own.id, { location_id: ids.locB })))).toMatchObject({ code: '23503', constraint: 'inventory_movements_location_product_fk' });
    expect(await failure(insertMov(admin, mov(own.id, { reverses_movement_id: uuidv7() })))).toMatchObject({ code: '23503', constraint: 'inventory_movements_reverses_fk' });
  });
});

describe('CHECKs reject impossible rows', () => {
  it('rejects an impossible sign per kind, a zero delta and an unknown kind', async () => {
    const own = doc();
    await insertDoc(admin, own);
    for (const [kind, quantity_delta] of [['entry', '-1'], ['transfer_in', '-1'], ['shrinkage', '1'], ['owner_withdrawal', '1'], ['transfer_out', '1'], ['adjustment', '0']] as const) {
      expect(await failure(insertMov(admin, mov(own.id, { kind, quantity_delta }))), `${kind} ${quantity_delta}`).toMatchObject({ code: '23514' });
    }
    // SP4: a sale takes stock out, so a positive sale violates the sign CHECK.
    expect(await failure(insertMov(admin, mov(own.id, { kind: 'sale', quantity_delta: '1' })))).toMatchObject({ code: '23514', constraint: 'inventory_movements_sign_check' });
    expect(await failure(insertMov(admin, mov(own.id, { kind: 'refund', quantity_delta: '1' })))).toMatchObject({ code: '23514', constraint: 'inventory_movements_kind_check' });
    await insertMov(admin, mov(own.id, { kind: 'sale', quantity_delta: '-1.5' }));
    // Signed kinds accept both signs.
    await insertMov(admin, mov(own.id, { kind: 'adjustment', quantity_delta: '-2' }));
    await insertMov(admin, mov(own.id, { kind: 'reversal', quantity_delta: '2' }));
    await insertMov(admin, mov(own.id, { kind: 'shrinkage', quantity_delta: '-0.001' }));
  });

  it('rejects a document whose shape does not match its kind', async () => {
    const bad: Record<string, unknown>[] = [
      { kind: 'refund' },
      { kind: 'sale', reason: 'shrinkage' },
      { kind: 'sale', target_location_id: ids.locA2 },
      { kind: 'exit', reason: null },
      { kind: 'exit', reason: 'theft' },
      { kind: 'entry', reason: 'shrinkage' },
      { kind: 'transfer', target_location_id: null },
      { kind: 'transfer', target_location_id: ids.locA },
      { kind: 'entry', target_location_id: ids.locA2 },
      { kind: 'reversal', reverses_document_id: null },
      { kind: 'entry', reverses_document_id: uuidv7() },
      { notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) },
    ];
    for (const overrides of bad) {
      expect(await failure(insertDoc(admin, doc(overrides))), JSON.stringify(overrides).slice(0, 80)).toMatchObject({ code: '23514' });
    }
    await insertDoc(admin, doc({ kind: 'exit', reason: 'owner_withdrawal' }));
    await insertDoc(admin, doc({ kind: 'transfer', target_location_id: ids.locA2 }));
    await insertDoc(admin, doc({ notes: 'x'.repeat(MAX_NOTES_LENGTH) }));
    await insertDoc(admin, doc({ kind: 'sale' }));
  });

  it('rejects negative amounts and unknown units, categories and currencies on products', async () => {
    const insert = (set: string, value: unknown) =>
      admin.query(`insert into products (id, tenant_id, name, unit_of_measure, currency, ${set}) values ($1, $2, 'P', 'ud', 'CUP', $3)`, [uuidv7(), TENANT_A, value]);
    for (const column of ['cost_price', 'cash_price', 'transfer_price', 'low_stock_threshold']) {
      expect(await failure(insert(column, -1)), column).toMatchObject({ code: '23514' });
    }
    expect(await failure(insert('category', 'Electrónica'))).toMatchObject({ code: '23514', constraint: 'products_category_check' });
    expect(await failure(admin.query(`insert into products (id, tenant_id, name, unit_of_measure, currency) values ($1, $2, 'P', 'lb', 'CUP')`, [uuidv7(), TENANT_A]))).toMatchObject({ constraint: 'products_unit_of_measure_check' });
    expect(await failure(admin.query(`insert into products (id, tenant_id, name, unit_of_measure, currency) values ($1, $2, 'P', 'ud', 'EUR')`, [uuidv7(), TENANT_A]))).toMatchObject({ constraint: 'products_currency_check' });
    expect(await failure(admin.query(`update location_products set cash_price_override = -1 where tenant_id = $1`, [TENANT_A]))).toMatchObject({ code: '23514' });
    expect(await failure(insertMov(admin, mov((await (async () => { const d = doc(); await insertDoc(admin, d); return d; })()).id, { unit_cost: '-1' })))).toMatchObject({ code: '23514' });
  });

  it('lets a document be reversed only once', async () => {
    const original = doc();
    await insertDoc(admin, original);
    await insertDoc(admin, doc({ kind: 'reversal', reverses_document_id: original.id }));
    expect(await failure(insertDoc(admin, doc({ kind: 'reversal', reverses_document_id: original.id })))).toMatchObject({
      code: '23505',
      constraint: 'inventory_documents_tenant_id_reverses_document_id_unique',
    });
  });
});

describe('monaco_app privileges on the new tables', () => {
  it('cannot UPDATE or DELETE ledger rows, nor DELETE products or location_products', async () => {
    const forbidden = (statement: string) => expect(app.query(statement)).rejects.toThrow(/permission denied/i);
    await forbidden('update inventory_documents set notes = null');
    await forbidden('delete from inventory_documents');
    await forbidden('update inventory_movements set unit_cost = 0');
    await forbidden('delete from inventory_movements');
    await forbidden('delete from products');
    await forbidden('delete from location_products');
    await forbidden('truncate table inventory_movements');
  });

  it('is bound by RLS: sees nothing without a tenant and cannot insert for another one', async () => {
    expect((await app.query('select 1 from products')).rowCount).toBe(0);
    await expect(
      app.query(`insert into products (id, tenant_id, name, unit_of_measure, currency) values ($1, $2, 'x', 'ud', 'CUP')`, [uuidv7(), TENANT_A]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('invariant: every movement is in a location of its document (used by T5a and T6)', () => {
  it('holds for one document of each kind, including a transfer and its reversal', async () => {
    const entry = doc();
    const transfer = doc({ kind: 'transfer', target_location_id: ids.locA2 });
    const reversal = doc({ kind: 'reversal', reverses_document_id: transfer.id });
    const sale = doc({ kind: 'sale' });
    for (const d of [entry, transfer, reversal, sale]) await insertDoc(admin, d);
    await insertMov(admin, mov(entry.id));
    await insertMov(admin, mov(sale.id, { kind: 'sale', quantity_delta: '-1' }));
    await insertMov(admin, mov(transfer.id, { kind: 'transfer_out', quantity_delta: '-1' }));
    await insertMov(admin, mov(transfer.id, { kind: 'transfer_in', quantity_delta: '1', location_id: ids.locA2 }));
    await insertMov(admin, mov(reversal.id, { kind: 'reversal', quantity_delta: '1' }));
    await insertMov(admin, mov(reversal.id, { kind: 'reversal', quantity_delta: '-1', location_id: ids.locA2 }));
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
  });

  it('flags a movement outside the locations of its document (the check is not vacuous)', async () => {
    const entry = doc();
    const transfer = doc({ kind: 'transfer', target_location_id: ids.locA2 });
    for (const d of [entry, transfer]) await insertDoc(admin, d);
    const stray = mov(entry.id, { location_id: ids.locA2 });
    const wrongSide = mov(transfer.id, { kind: 'transfer_in', quantity_delta: '1' });
    await insertMov(admin, stray);
    await insertMov(admin, wrongSide);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([stray.id, wrongSide.id].sort());
  });
});

describe('invariant helper: NULL comparisons and kind mismatches are violations', () => {
  it('flags a reversal of a non-transfer document with a line in another location', async () => {
    const entry = doc();
    const reversal = doc({ kind: 'reversal', reverses_document_id: entry.id });
    for (const d of [entry, reversal]) await insertDoc(admin, d);
    const stray = mov(reversal.id, { kind: 'reversal', quantity_delta: '-1', location_id: ids.locA2 });
    await insertMov(admin, stray);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([stray.id]);
  });

  it('flags a transfer_in inside a document without target location', async () => {
    const entry = doc();
    await insertDoc(admin, entry);
    const stray = mov(entry.id, { kind: 'transfer_in', quantity_delta: '1' });
    await insertMov(admin, stray);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([stray.id]);
  });

  it('flags a reversal movement inside a non-reversal document', async () => {
    const entry = doc();
    await insertDoc(admin, entry);
    const stray = mov(entry.id, { kind: 'reversal', quantity_delta: '1' });
    await insertMov(admin, stray);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([stray.id]);
  });

  it('flags a movement kind that its document kind cannot hold', async () => {
    const entry = doc();
    const exit = doc({ kind: 'exit', reason: 'shrinkage' });
    for (const d of [entry, exit]) await insertDoc(admin, d);
    const sale = doc({ kind: 'sale' });
    await insertDoc(admin, sale);
    const wrongKind = mov(entry.id, { kind: 'adjustment', quantity_delta: '1' });
    const wrongExit = mov(exit.id, { kind: 'entry' });
    const saleInEntry = mov(entry.id, { kind: 'sale', quantity_delta: '-1' });
    const shrinkageInSale = mov(sale.id, { kind: 'shrinkage', quantity_delta: '-1' });
    for (const m of [wrongKind, wrongExit, saleInEntry, shrinkageInSale]) await insertMov(admin, m);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([wrongKind.id, wrongExit.id, saleInEntry.id, shrinkageInSale.id].sort());
  });
});

describe('stock sum index', () => {
  it('covers the sum with an INCLUDE column (index-only scans)', async () => {
    const { rows } = await admin.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = 'inventory_movements_stock_sum_idx'`);
    expect(rows[0]?.def).toContain('(tenant_id, location_id, product_id) INCLUDE (quantity_delta)');
  });
});
