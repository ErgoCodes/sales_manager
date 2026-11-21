import { InventoryDocument, PaginatedInventoryMovements, PaginatedStockItems, ProductStock } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { loginAs, resetAll, type SeededTenant, Seeder, type Session } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';
import { exitBody, insertProduct, insertTransfer, recordEntry } from './inventory-fixtures';

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let b: SeededTenant;
let rice: string;
let beans: string;
let productOfB: string;

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
  rice = await insertProduct(admin, a.id, 'Arroz');
  beans = await insertProduct(admin, a.id, 'Frijol');
  productOfB = await insertProduct(admin, b.id, 'Azúcar');
  await seeder.user(a.id, 'manager1@a.example', [[a.roles.manager, [L1()]]]);
  await seeder.user(a.id, 'cashier1@a.example', [[a.roles.cashier, [L1()]]]);
});

const [L1, L2] = [() => a.locations[0], () => a.locations[1]];
const cup = (amount: number) => ({ amount, currency: 'CUP' as const });

const stock = async (session: Session, location: string, query = '') =>
  PaginatedStockItems.parse((await session.get(`/locations/${location}/stock${query}`).expect(200)).body);
const movements = async (session: Session, location: string, query = '') =>
  PaginatedInventoryMovements.parse((await session.get(`/locations/${location}/inventory-movements${query}`).expect(200)).body);
const productStock = async (session: Session, product: string) => ProductStock.parse((await session.get(`/products/${product}/stock`).expect(200)).body);
const document = async (session: Session, id: string) => InventoryDocument.parse((await session.get(`/inventory/documents/${id}`).expect(200)).body);

describe('GET /locations/:locationId/stock', () => {
  it('lists every active product with its stock, effective threshold and average cost (writer)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), rice, 10, 100);
    await recordEntry(owner, L1(), rice, 10, 200);
    await owner.post('/inventory/exits', exitBody(L1(), rice, 2.5)).expect(201);

    const page = await stock(owner, L1());
    expect(page.items).toEqual([
      { productId: rice, name: 'Arroz', unitOfMeasure: 'kg', category: null, quantity: 17.5, lowStockThreshold: 5, isLow: false, averageCost: cup(150), archivedAt: null },
      { productId: beans, name: 'Frijol', unitOfMeasure: 'kg', category: null, quantity: 0, lowStockThreshold: 5, isLow: true, averageCost: cup(0), archivedAt: null },
    ]);
    expect((await stock(owner, L1(), '?lowStockOnly=true')).items.map((i) => i.productId)).toEqual([beans]);
    expect((await stock(owner, L1(), '?q=arr')).items.map((i) => i.productId)).toEqual([rice]);
  });

  it('paginates by name, also when filtering low stock; an archived product shows only while it holds stock', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const names = ['Café', 'Dulce', 'Ensalada'];
    for (const name of names) await insertProduct(admin, a.id, name);
    await recordEntry(owner, L1(), beans, 50, 10);
    const first = await stock(owner, L1(), '?lowStockOnly=true&limit=2');
    expect(first.items.map((i) => i.name)).toEqual(['Arroz', 'Café']);
    const second = await stock(owner, L1(), `?lowStockOnly=true&limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((i) => i.name)).toEqual(['Dulce', 'Ensalada']);
    expect(second.nextCursor).toBeNull();

    await insertProduct(admin, a.id, 'Viejo sin stock', 'CUP', true);
    await admin.query('update products set archived_at = now() where id = $1', [beans]);
    const withArchived = await stock(owner, L1(), '?limit=100');
    expect(withArchived.items.map((i) => i.name)).toEqual(['Arroz', 'Café', 'Dulce', 'Ensalada', 'Frijol']);
    expect(withArchived.items.at(-1)!.archivedAt).not.toBeNull();
  });

  it('a cashier reads its location without costs, and gets 403 in another location', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), rice, 3, 100);
    await recordEntry(owner, L2(), rice, 4, 100);
    const cashier = await loginAs(app, 'cashier1@a.example');
    const page = await stock(cashier, L1());
    expect(page.items[0]).toMatchObject({ productId: rice, quantity: 3, averageCost: null });
    expect(JSON.stringify(page)).not.toContain('"amount"');
    await cashier.get(`/locations/${L2()}/stock`).expect(403);
    const manager = await loginAs(app, 'manager1@a.example');
    expect((await stock(manager, L1())).items[0]).toMatchObject({ averageCost: cup(100) });
    await manager.get(`/locations/${L2()}/stock`).expect(403);
  });
});

describe('GET /products/:id/stock', () => {
  it('returns only the locations the actor can view, with costs only where it writes', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), rice, 3, 100);
    await recordEntry(owner, L2(), rice, 4, 80);

    expect(await productStock(owner, rice)).toEqual({
      productId: rice,
      locations: [
        { locationId: L1(), locationName: 'Location L1', quantity: 3, averageCost: cup(100) },
        { locationId: L2(), locationName: 'Location L2', quantity: 4, averageCost: cup(80) },
      ],
    });
    const manager = await loginAs(app, 'manager1@a.example');
    expect((await productStock(manager, rice)).locations).toEqual([{ locationId: L1(), locationName: 'Location L1', quantity: 3, averageCost: cup(100) }]);
    const cashier = await loginAs(app, 'cashier1@a.example');
    const seen = await productStock(cashier, rice);
    expect(seen.locations).toEqual([{ locationId: L1(), locationName: 'Location L1', quantity: 3, averageCost: null }]);
    expect(JSON.stringify(seen)).not.toContain(L2());
  });

  it('is a 403 without inventory:view anywhere', async () => {
    const role = await seeder.role(a.id, 'Nothing', ['catalog:view']);
    await seeder.user(a.id, 'nobody@a.example', [[role, 'tenant']]);
    const nobody = await loginAs(app, 'nobody@a.example');
    await nobody.get(`/products/${rice}/stock`).expect(403);
    await nobody.get(`/inventory/documents/${uuidv7()}`).expect(403);
  });
});

describe('GET /locations/:locationId/inventory-movements', () => {
  it('lists the ledger of a location newest first, paginated and filtered', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const first = await recordEntry(owner, L1(), rice, 10, 100);
    const second = await recordEntry(owner, L1(), beans, 5, 50);
    const exit = InventoryDocument.parse((await owner.post('/inventory/exits', exitBody(L1(), rice, 1)).expect(201)).body);
    await recordEntry(owner, L2(), rice, 1, 1);

    const all = await movements(owner, L1());
    expect(all.items.map((m) => m.documentId)).toEqual([exit.id, second.id, first.id]);
    expect(all.items[0]).toMatchObject({ locationId: L1(), kind: 'shrinkage', quantityDelta: -1, unitCost: cup(100), counterpartLocationId: null, counterpartLocationName: null });

    const page1 = await movements(owner, L1(), '?limit=2');
    expect(page1.items.map((m) => m.documentId)).toEqual([exit.id, second.id]);
    const page2 = await movements(owner, L1(), `?limit=2&cursor=${page1.nextCursor}`);
    expect(page2.items.map((m) => m.documentId)).toEqual([first.id]);
    expect(page2.nextCursor).toBeNull();

    expect((await movements(owner, L1(), `?productId=${rice}`)).items.map((m) => m.documentId)).toEqual([exit.id, first.id]);
    expect((await movements(owner, L1(), '?kind=entry')).items.map((m) => m.documentId)).toEqual([second.id, first.id]);
    // A document header is stamped before its movements: its createdAt splits the ledger between documents.
    expect((await movements(owner, L1(), `?from=${encodeURIComponent(second.createdAt)}`)).items.map((m) => m.documentId)).toEqual([exit.id, second.id]);
    expect((await movements(owner, L1(), `?to=${encodeURIComponent(second.createdAt)}`)).items.map((m) => m.documentId)).toEqual([first.id]);
    await owner.get(`/locations/${L1()}/inventory-movements?kind=bogus`).expect(400);
  });

  it('hides unit costs from a cashier and is a 403 in another location', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), rice, 10, 100);
    const cashier = await loginAs(app, 'cashier1@a.example');
    expect((await movements(cashier, L1())).items.map((m) => m.unitCost)).toEqual([null]);
    await cashier.get(`/locations/${L2()}/inventory-movements`).expect(403);
    const manager = await loginAs(app, 'manager1@a.example');
    await manager.get(`/locations/${L2()}/inventory-movements`).expect(403);
  });
});

describe('GET /inventory/documents/:id', () => {
  it('returns the document with its movements; 403 for a document of a location outside the scope', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const atL1 = await recordEntry(owner, L1(), rice, 10, 100);
    const atL2 = await recordEntry(owner, L2(), rice, 10, 100);
    const manager = await loginAs(app, 'manager1@a.example');
    expect(await document(manager, atL1.id)).toEqual(atL1);
    expect(atL1).toMatchObject({ locationId: L1(), locationName: 'Location L1', targetLocationId: null, targetLocationName: null });
    await manager.get(`/inventory/documents/${atL2.id}`).expect(403);
    const cashier = await loginAs(app, 'cashier1@a.example');
    expect((await document(cashier, atL1.id)).movements[0]!.unitCost).toBeNull();
    await cashier.get(`/inventory/documents/${atL2.id}`).expect(403);
  });
});

describe('transfer masking ("otro punto")', () => {
  it('location 1 never sees the id or name of location 2 in a transfer; whoever views both does', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), rice, 10, 100);
    const transferId = await insertTransfer(admin, a, L1(), L2(), rice, 4, 100);

    const manager = await loginAs(app, 'manager1@a.example');
    const listed = await movements(manager, L1(), `?kind=transfer_out`);
    expect(listed.items).toEqual([expect.objectContaining({ documentId: transferId, locationId: L1(), counterpartLocationId: null, counterpartLocationName: null, quantityDelta: -4 })]);
    const detail = await document(manager, transferId);
    expect(detail).toMatchObject({ kind: 'transfer', locationId: L1(), locationName: 'Location L1', targetLocationId: null, targetLocationName: null });
    expect(detail.movements.map((m) => m.kind)).toEqual(['transfer_out']);
    for (const body of [listed, detail]) {
      expect(JSON.stringify(body)).not.toContain(L2());
      expect(JSON.stringify(body)).not.toContain('Location L2');
    }

    // The destination side sees its own movement, with the origin masked.
    await seeder.user(a.id, 'cashier2@a.example', [[a.roles.cashier, [L2()]]]);
    const cashier2 = await loginAs(app, 'cashier2@a.example');
    const fromDestination = await document(cashier2, transferId);
    expect(fromDestination).toMatchObject({ locationId: null, locationName: null, targetLocationId: L2(), targetLocationName: 'Location L2' });
    expect(fromDestination.movements).toEqual([expect.objectContaining({ kind: 'transfer_in', counterpartLocationId: null, unitCost: null })]);
    expect(JSON.stringify(fromDestination)).not.toContain(L1());

    const full = await document(owner, transferId);
    expect(full).toMatchObject({ locationId: L1(), locationName: 'Location L1', targetLocationId: L2(), targetLocationName: 'Location L2' });
    expect(full.movements.map((m) => [m.kind, m.counterpartLocationId, m.counterpartLocationName])).toEqual([
      ['transfer_out', L2(), 'Location L2'],
      ['transfer_in', L1(), 'Location L1'],
    ]);
    expect((await movements(owner, L2())).items[0]).toMatchObject({ kind: 'transfer_in', counterpartLocationId: L1(), counterpartLocationName: 'Location L1' });
    expect((await stock(owner, L2())).items.find((i) => i.productId === rice)).toMatchObject({ quantity: 4 });
  });
});

describe('custom role with only inventory:write (D9 + D10)', () => {
  it('reads what it writes, with costs, and nothing of another location', async () => {
    const role = await seeder.role(a.id, 'Receiver', ['inventory:write']);
    await seeder.user(a.id, 'receiver@a.example', [[role, [L1()]]]);
    const receiver = await loginAs(app, 'receiver@a.example');
    const written = await recordEntry(receiver, L1(), rice, 6, 120);
    const owner = await loginAs(app, 'owner@a.example');
    const elsewhere = await recordEntry(owner, L2(), rice, 1, 1);

    expect(await document(receiver, written.id)).toEqual(written);
    expect(written.movements[0]!.unitCost).toEqual(cup(120));
    expect((await stock(receiver, L1())).items.find((i) => i.productId === rice)).toMatchObject({ quantity: 6, averageCost: cup(120) });
    expect((await movements(receiver, L1())).items[0]).toMatchObject({ documentId: written.id, unitCost: cup(120) });
    expect((await productStock(receiver, rice)).locations).toEqual([{ locationId: L1(), locationName: 'Location L1', quantity: 6, averageCost: cup(120) }]);

    await receiver.get(`/locations/${L2()}/stock`).expect(403);
    await receiver.get(`/locations/${L2()}/inventory-movements`).expect(403);
    await receiver.get(`/inventory/documents/${elsewhere.id}`).expect(403);
  });
});

describe('cross-tenant reads', () => {
  it("tenant A gets 404 on every read with tenant B's ids, and sees none of B's data", async () => {
    const ownerB = await loginAs(app, 'owner@b.example');
    const docOfB = await recordEntry(ownerB, b.locations[0], productOfB, 5, 10);
    const ownerA = await loginAs(app, 'owner@a.example');
    await recordEntry(ownerA, L1(), rice, 1, 1);
    const missing = uuidv7();

    for (const location of [b.locations[0], missing]) {
      await ownerA.get(`/locations/${location}/stock`).expect(404);
      await ownerA.get(`/locations/${location}/inventory-movements`).expect(404);
    }
    for (const product of [productOfB, missing]) await ownerA.get(`/products/${product}/stock`).expect(404);
    for (const id of [docOfB.id, missing]) await ownerA.get(`/inventory/documents/${id}`).expect(404);

    const own = JSON.stringify([await stock(ownerA, L1()), await movements(ownerA, L1()), await productStock(ownerA, rice)]);
    for (const leaked of [b.locations[0], productOfB, docOfB.id, 'Azúcar']) expect(own).not.toContain(leaked);
  });

  it('rejects malformed ids and requires authentication', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await owner.get('/locations/not-a-uuid/stock').expect(400);
    await owner.get('/inventory/documents/not-a-uuid').expect(400);
    const { default: request } = await import('supertest');
    await request(app.getHttpServer()).get(`/locations/${L1()}/stock`).expect(401);
  });
});
