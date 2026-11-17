import { PaginatedProducts, Product, ProductWithLocationPrice } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { auditRows, loginAs, resetAll, type SeededTenant, Seeder, type Session } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  admin = adminPool();
  seeder = new Seeder(admin);
  app = await createAuthApp();
});
afterAll(async () => {
  await app.close();
  await resetAll(admin);
  await admin.end();
});
beforeEach(async () => {
  await resetAll(admin);
  a = await seeder.tenant('a');
  b = await seeder.tenant('b');
  await seeder.user(a.id, 'manager@a.example', [[a.roles.manager, [a.locations[0]]]]);
  await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
});

const cup = (amount: number) => ({ amount, currency: 'CUP' as const });
const newProduct = (name: string, extra: object = {}) => ({ name, unitOfMeasure: 'ud', currency: 'CUP', costPrice: cup(800), cashPrice: cup(1000), transferPrice: cup(1200), ...extra });
const create = async (session: Session, name: string, extra: object = {}) => Product.parse((await session.post('/products', newProduct(name, extra)).expect(201)).body);

/** A ledger movement of the product at a location, as the superuser (what T5a writes through the API). */
async function recordMovement(tenant: SeededTenant, locationId: string, productId: string): Promise<void> {
  const documentId = uuidv7();
  await admin.query(`insert into location_products (tenant_id, location_id, product_id) values ($1, $2, $3) on conflict do nothing`, [tenant.id, locationId, productId]);
  await admin.query(
    `insert into inventory_documents (id, tenant_id, kind, location_id, occurred_at, payload_hash, created_by) values ($1, $2, 'entry', $3, now(), 'h', $4)`,
    [documentId, tenant.id, locationId, tenant.owner],
  );
  await admin.query(
    `insert into inventory_movements (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost) values ($1, $2, $3, $4, $5, 'entry', 5, 800)`,
    [uuidv7(), tenant.id, documentId, locationId, productId],
  );
}

const productRow = async (id: string) => (await admin.query('select * from products where id = $1', [id])).rows[0] as Record<string, unknown> | undefined;

describe('product lifecycle (Owner)', () => {
  it('creates, reads, edits and archives a product; every step is audited without costs', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const created = await create(owner, 'Agua', { category: 'Bebidas', unitOfMeasure: 'litro', lowStockThreshold: 2.5, expirationDate: '2027-01-31' });
    expect(created).toMatchObject({ name: 'Agua', unitOfMeasure: 'litro', category: 'Bebidas', currency: 'CUP', costPrice: cup(800), cashPrice: cup(1000), lowStockThreshold: 2.5, expirationDate: '2027-01-31', archivedAt: null });

    const fetched = ProductWithLocationPrice.parse((await owner.get(`/products/${created.id}`).expect(200)).body);
    expect(fetched).toMatchObject({ id: created.id, effectiveCashPrice: cup(1000), cashPriceOverride: null });

    const edited = Product.parse((await owner.patch(`/products/${created.id}`, { name: 'Agua 2', category: null, transferPrice: null, costPrice: cup(900) }).expect(200)).body);
    expect(edited).toMatchObject({ name: 'Agua 2', category: null, transferPrice: null, costPrice: cup(900), cashPrice: cup(1000) });

    const archived = Product.parse((await owner.post(`/products/${created.id}/archive`).expect(200)).body);
    expect(archived.archivedAt).not.toBeNull();
    const again = Product.parse((await owner.post(`/products/${created.id}/archive`).expect(200)).body);
    expect(again.archivedAt).toBe(archived.archivedAt);

    const audit = (await auditRows(admin, a.id)).filter((row) => row.type.startsWith('product_'));
    expect(audit.map((row) => [row.type, row.actor_user_id, row.target_id])).toEqual([
      ['product_created', a.owner, created.id],
      ['product_updated', a.owner, created.id],
      ['product_archived', a.owner, created.id],
    ]);
    expect(JSON.stringify(audit.map((row) => row.metadata))).not.toMatch(/800|900/); // field names only, never amounts
    expect(audit[1]!.metadata).toEqual({ fields: ['name', 'category', 'costPrice', 'transferPrice'] });
  });

  it('lists by (name, id) in pages, with search, category and archived filters', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const agua = await create(owner, 'Agua', { category: 'Bebidas' });
    const arroz = await create(owner, 'Arroz', { category: 'Granos' });
    const azucar = await create(owner, 'Azucar', { category: 'Granos' });
    await create(owner, 'Arroz', { category: 'Granos' }); // same name: the id breaks the tie
    await owner.post(`/products/${azucar.id}/archive`).expect(200);

    const page = async (query: string) => PaginatedProducts.parse((await owner.get(`/products?${query}`).expect(200)).body);
    const first = await page('limit=2');
    expect(first.items.map((p) => p.name)).toEqual(['Agua', 'Arroz']);
    expect(first.items[0]!.id).toBe(agua.id);
    const second = await page(`limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(1); // the archived product is hidden
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((p) => p.id);
    expect(new Set(seen).size).toBe(3);
    expect(seen).toContain(arroz.id);

    expect((await page('q=ARR')).items.map((p) => p.name)).toEqual(['Arroz', 'Arroz']);
    expect((await page('category=Bebidas')).items.map((p) => p.id)).toEqual([agua.id]);
    expect((await page('includeArchived=true')).items).toHaveLength(4);
    expect((await page(`q=${encodeURIComponent("%'_")}`)).items).toEqual([]);
  });

  it('rejects a forged cursor, an unknown unit or category (400) and an amount in another currency (422)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    expect((await owner.get('/products?cursor=nope').expect(400)).body.error.code).toBe('INVALID_CURSOR');
    const unit = await owner.post('/products', newProduct('X', { unitOfMeasure: 'parsec' })).expect(400);
    expect(unit.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'unitOfMeasure' }] });
    await owner.post('/products', newProduct('X', { category: 'Nope' })).expect(400);
    const mismatch = await owner.post('/products', newProduct('X', { cashPrice: { amount: 5, currency: 'USD' } })).expect(422);
    expect(mismatch.body.error.code).toBe('CURRENCY_MISMATCH');
    expect(await admin.query('select 1 from products where tenant_id = $1', [a.id]).then((r) => r.rowCount)).toBe(0);
  });

  it('the currency is immutable once the product has movements, but can change before', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const free = await create(owner, 'Libre');
    const moved = await create(owner, 'Movido');
    await recordMovement(a, a.locations[0], moved.id);

    const changed = Product.parse((await owner.patch(`/products/${free.id}`, { currency: 'USD', costPrice: { amount: 5, currency: 'USD' }, cashPrice: { amount: 9, currency: 'USD' }, transferPrice: null }).expect(200)).body);
    expect(changed).toMatchObject({ currency: 'USD', cashPrice: { amount: 9, currency: 'USD' } });

    const res = await owner.patch(`/products/${moved.id}`, { currency: 'USD' }).expect(422);
    expect(res.body.error.code).toBe('CURRENCY_MISMATCH');
    expect((await productRow(moved.id))!.currency).toBe('CUP');
    await owner.patch(`/products/${moved.id}`, { name: 'Movido 2', currency: 'CUP' }).expect(200);
  });
});

describe('location prices and scope', () => {
  it('a Manager sets the price of their own location: effective price, removal, archived product and currency', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const manager = await loginAs(app, 'manager@a.example');
    const [l1] = a.locations;
    const product = await create(owner, 'Agua');
    const path = `/locations/${l1}/products/${product.id}/price`;

    const set = ProductWithLocationPrice.parse((await manager.put(path, { cashPrice: cup(900), transferPrice: null }).expect(200)).body);
    expect(set).toMatchObject({ effectiveCashPrice: cup(900), cashPriceOverride: cup(900), effectiveTransferPrice: cup(1200), transferPriceOverride: null, costPrice: cup(800) });
    const listed = PaginatedProducts.parse((await manager.get(`/products?locationId=${l1}`).expect(200)).body);
    expect(listed.items[0]).toMatchObject({ effectiveCashPrice: cup(900) });
    const base = PaginatedProducts.parse((await owner.get('/products').expect(200)).body);
    expect(base.items[0]).toMatchObject({ cashPrice: cup(1000), effectiveCashPrice: cup(1000), cashPriceOverride: null });

    const removed = ProductWithLocationPrice.parse((await manager.put(path, { cashPrice: null, transferPrice: cup(1100) }).expect(200)).body);
    expect(removed).toMatchObject({ effectiveCashPrice: cup(1000), cashPriceOverride: null, effectiveTransferPrice: cup(1100) });

    expect((await manager.put(path, { cashPrice: { amount: 1, currency: 'USD' }, transferPrice: null }).expect(422)).body.error.code).toBe('CURRENCY_MISMATCH');
    await owner.post(`/products/${product.id}/archive`).expect(200);
    expect((await manager.put(path, { cashPrice: cup(1), transferPrice: null }).expect(409)).body.error.code).toBe('ARCHIVED');

    const audit = (await auditRows(admin, a.id)).filter((row) => row.type === 'location_price_set');
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ target_id: product.id, metadata: { locationId: l1, cashPrice: 900, transferPrice: null } });
  });

  it('a Manager gets 403 on another location and on product writes; nothing changes', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const manager = await loginAs(app, 'manager@a.example');
    const product = await create(owner, 'Agua');
    const [, l2] = a.locations;

    await manager.put(`/locations/${l2}/products/${product.id}/price`, { cashPrice: cup(1), transferPrice: null }).expect(403);
    await manager.post('/products', newProduct('Nuevo')).expect(403);
    await manager.patch(`/products/${product.id}`, { name: 'Hack' }).expect(403);
    await manager.post(`/products/${product.id}/archive`).expect(403);
    await manager.get(`/products?locationId=${l2}`).expect(403);

    expect((await productRow(product.id))).toMatchObject({ name: 'Agua', archived_at: null });
    expect((await admin.query('select 1 from location_products where tenant_id = $1', [a.id])).rowCount).toBe(0);
    expect((await admin.query('select 1 from products where tenant_id = $1', [a.id])).rowCount).toBe(1);
  });

  it('a Cashier reads the catalog of their location without costs and gets 403 on every write', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const cashier = await loginAs(app, 'cashier@a.example');
    const product = await create(owner, 'Agua');
    const [l1, l2] = a.locations;
    await owner.put(`/locations/${l1}/products/${product.id}/price`, { cashPrice: cup(900), transferPrice: null }).expect(200);

    const atL1 = PaginatedProducts.parse((await cashier.get(`/products?locationId=${l1}`).expect(200)).body);
    expect(atL1.items[0]).toMatchObject({ costPrice: null, effectiveCashPrice: cup(900) });
    const one = ProductWithLocationPrice.parse((await cashier.get(`/products/${product.id}?locationId=${l1}`).expect(200)).body);
    expect(one.costPrice).toBeNull();
    const anywhere = PaginatedProducts.parse((await cashier.get('/products').expect(200)).body);
    expect(anywhere.items[0]).toMatchObject({ costPrice: null, cashPrice: cup(1000) });

    await cashier.get(`/products?locationId=${l2}`).expect(403);
    await cashier.get(`/products/${product.id}?locationId=${l2}`).expect(403);
    await cashier.post('/products', newProduct('X')).expect(403);
    await cashier.patch(`/products/${product.id}`, { name: 'X' }).expect(403);
    await cashier.post(`/products/${product.id}/archive`).expect(403);
    await cashier.put(`/locations/${l1}/products/${product.id}/price`, { cashPrice: cup(1), transferPrice: null }).expect(403);
  });

  it('a custom role with only catalog:write at a location reads the catalog there (D9) and sees costs', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await create(owner, 'Agua');
    const role = await seeder.role(a.id, 'Pricer', ['catalog:write']);
    await seeder.user(a.id, 'pricer@a.example', [[role, [a.locations[0]]]]);
    const pricer = await loginAs(app, 'pricer@a.example');
    const listed = PaginatedProducts.parse((await pricer.get(`/products?locationId=${a.locations[0]}`).expect(200)).body);
    expect(listed.items[0]).toMatchObject({ costPrice: cup(800) });
    await pricer.get(`/products?locationId=${a.locations[1]}`).expect(403);
  });

  it('a user with no catalog permission anywhere gets 403 on reads', async () => {
    const role = await seeder.role(a.id, 'Nothing', []);
    await seeder.user(a.id, 'nobody@a.example', [[role, 'tenant']]);
    const nobody = await loginAs(app, 'nobody@a.example');
    await nobody.get('/products').expect(403);
    await nobody.get(`/products/${uuidv7()}`).expect(403);
  });
});

describe('cross-tenant matrix', () => {
  /** Every row tenant B owns in the catalog, the ledger and the audit log, as JSON. */
  async function snapshot(tenantId: string): Promise<string> {
    const out: Record<string, string[]> = {};
    for (const table of ['products', 'location_products', 'inventory_documents', 'inventory_movements', 'audit_events', 'locations']) {
      out[table] = (await admin.query(`select to_jsonb(t) as row from ${table} t where tenant_id = $1`, [tenantId])).rows.map((r) => JSON.stringify(r.row)).sort();
    }
    return JSON.stringify(out);
  }

  it("tenant A against every endpoint with tenant B's ids gets 404 and B stays intact", async () => {
    const ownerB = await loginAs(app, 'owner@b.example');
    const productB = await create(ownerB, 'Producto B');
    await recordMovement(b, b.locations[0], productB.id);
    const [locB] = b.locations;
    const before = await snapshot(b.id);

    const ownerA = await loginAs(app, 'owner@a.example');
    const productA = await create(ownerA, 'Producto A');
    const missing = uuidv7();
    const [locA] = a.locations;

    for (const id of [productB.id, missing]) {
      await ownerA.get(`/products/${id}`).expect(404);
      await ownerA.get(`/products/${id}?locationId=${locA}`).expect(404);
      await ownerA.patch(`/products/${id}`, { name: 'Hack', currency: 'USD' }).expect(404);
      await ownerA.post(`/products/${id}/archive`).expect(404);
      await ownerA.put(`/locations/${locA}/products/${id}/price`, { cashPrice: cup(1), transferPrice: null }).expect(404);
    }
    for (const location of [locB, missing]) {
      await ownerA.get(`/products?locationId=${location}`).expect(404);
      await ownerA.get(`/products/${productA.id}?locationId=${location}`).expect(404);
      await ownerA.put(`/locations/${location}/products/${productA.id}/price`, { cashPrice: cup(1), transferPrice: null }).expect(404);
    }
    const listed = PaginatedProducts.parse((await ownerA.get('/products?includeArchived=true').expect(200)).body);
    expect(listed.items.map((p) => p.id)).toEqual([productA.id]);

    expect(await snapshot(b.id)).toBe(before);
    expect((await productRow(productA.id))).toMatchObject({ name: 'Producto A' });
    expect((await admin.query('select 1 from location_products where tenant_id = $1 and product_id = $2', [a.id, productA.id])).rowCount).toBe(0);
  });
});
