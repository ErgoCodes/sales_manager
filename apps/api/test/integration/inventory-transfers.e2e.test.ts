import { InventoryDocument } from '@monaco/contracts';
import { blendAverageCost } from '@monaco/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { auditRows, loginAs, resetAll, type SeededTenant, Seeder } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';
import {
  averageCostOf,
  countRows,
  exitBody,
  insertProduct,
  recordEntry,
  recordTransfer,
  reversalBody,
  stockOf,
  transferBody,
} from './inventory-fixtures';
import { movementsOutsideDocumentLocations } from './inventory-invariants';

/* SP3·T6: transfers (D6, D7, D15) and reversals (D8) through the API, on a real database. */

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let b: SeededTenant;
let productA: string;
let productB: string;

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
  productA = await insertProduct(admin, a.id, 'Arroz');
  productB = await insertProduct(admin, a.id, 'Frijol');
});

const [L1, L2] = [() => a.locations[0], () => a.locations[1]];
const ledgerIsConsistent = async () => expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
const owner = () => loginAs(app, 'owner@a.example');
/** A Manager (inventory:transfer and inventory:write) only in the given locations. */
async function managerAt(email: string, locations: string[]) {
  await seeder.user(a.id, email, [[a.roles.manager, locations]]);
  return loginAs(app, email);
}
const snapshot = async () => ({
  documents: await countRows(admin, 'inventory_documents', a.id),
  movements: await countRows(admin, 'inventory_movements', a.id),
  stock: [await stockOf(admin, a.id, L1(), productA), await stockOf(admin, a.id, L2(), productA)],
});

describe('POST /inventory/transfers', () => {
  it('one document: transfer_out in the origin, transfer_in in the destination, the destination blends the origin cost', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    await recordEntry(session, L2(), productA, 10, 300);
    const body = { ...transferBody(L1(), L2(), productA, 4), notes: 'Reparto' };
    const res = await session.post('/inventory/transfers', body).expect(201);
    const doc = InventoryDocument.parse(res.body);
    expect(doc).toMatchObject({
      id: body.id,
      kind: 'transfer',
      locationId: L1(),
      locationName: 'Location L1',
      targetLocationId: L2(),
      targetLocationName: 'Location L2',
      notes: 'Reparto',
      movements: [
        { locationId: L1(), counterpartLocationId: L2(), productId: productA, kind: 'transfer_out', quantityDelta: -4, unitCost: { amount: 100, currency: 'CUP' } },
        { locationId: L2(), counterpartLocationId: L1(), productId: productA, kind: 'transfer_in', quantityDelta: 4, unitCost: { amount: 100, currency: 'CUP' } },
      ],
    });
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(6);
    expect(await stockOf(admin, a.id, L2(), productA)).toBe(14);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(100);
    expect(await averageCostOf(admin, a.id, L2(), productA)).toBeCloseTo(blendAverageCost(10, 300, 4, 100), 6);
    const audit = (await auditRows(admin, a.id)).filter((row) => row.type === 'inventory_transfer_recorded');
    expect(audit).toEqual([
      { type: 'inventory_transfer_recorded', actor_user_id: a.owner, target_id: body.id, metadata: { fromLocationId: L1(), toLocationId: L2(), lineCount: 1 } },
    ]);
    await ledgerIsConsistent();
  });

  it('creates the destination pair lazily: an empty destination takes the origin cost', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 120);
    await recordTransfer(session, L1(), L2(), productA, 10);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
    expect(await averageCostOf(admin, a.id, L2(), productA)).toBe(120);
  });

  it('without inventory:transfer in the destination (or the origin): 403 and no effect', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    await recordEntry(session, L2(), productA, 10, 100);
    const before = await snapshot();
    const manager = await managerAt('m1@a.example', [L1()]);
    expect((await manager.post('/inventory/transfers', transferBody(L1(), L2(), productA, 1)).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await manager.post('/inventory/transfers', transferBody(L2(), L1(), productA, 1)).expect(403)).body.error.code).toBe('FORBIDDEN');
    const cashier = await (async () => {
      await seeder.user(a.id, 'c@a.example', [[a.roles.cashier, 'tenant']]);
      return loginAs(app, 'c@a.example');
    })();
    await cashier.post('/inventory/transfers', transferBody(L1(), L2(), productA, 1)).expect(403);
    expect(await snapshot()).toEqual(before);
    // With the permission at both ends the same Manager-role transfer goes through.
    const both = await managerAt('m12@a.example', [L1(), L2()]);
    await both.post('/inventory/transfers', transferBody(L1(), L2(), productA, 1)).expect(201);
  });

  it('a transfer that would leave the origin negative: 409 and nothing moves (atomic across lines)', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    await recordEntry(session, L1(), productB, 2, 100);
    const before = { ...(await snapshot()), b: await stockOf(admin, a.id, L1(), productB) };
    const body = { ...transferBody(L1(), L2(), productA, 5), lines: [{ productId: productA, quantity: 5 }, { productId: productB, quantity: 3 }] };
    const res = await session.post('/inventory/transfers', body).expect(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: [{ path: productB }] });
    expect({ ...(await snapshot()), b: await stockOf(admin, a.id, L1(), productB) }).toEqual(before);
    expect(await stockOf(admin, a.id, L2(), productB)).toBe(0);
  });

  it('D15: transfer_out from an archived location passes; transfer_in to an archived one or of an archived product is ARCHIVED', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    await recordEntry(session, L1(), productB, 10, 100);
    await admin.query('update locations set archived_at = now() where id = $1', [L1()]);
    await session.post('/inventory/transfers', transferBody(L1(), L2(), productA, 10)).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);

    await admin.query('update products set archived_at = now() where id = $1', [productB]);
    expect((await session.post('/inventory/transfers', transferBody(L1(), L2(), productB, 1)).expect(409)).body.error.code).toBe('ARCHIVED');

    await admin.query('update locations set archived_at = null where id = $1', [L1()]);
    await admin.query('update locations set archived_at = now() where id = $1', [L2()]);
    await session.post('/inventory/exits', exitBody(L2(), productA, 1)).expect(201);
    expect((await session.post('/inventory/transfers', transferBody(L2(), L1(), productA, 1)).expect(201)).body.kind).toBe('transfer');
    expect((await session.post('/inventory/transfers', transferBody(L1(), L2(), productA, 1)).expect(409)).body.error.code).toBe('ARCHIVED');
    await ledgerIsConsistent();
  });

  it('validation, another tenant and idempotency', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    await session.post('/inventory/transfers', transferBody(L1(), L1(), productA, 1)).expect(400);
    await session.post('/inventory/transfers', transferBody(L1(), b.locations[0], productA, 1)).expect(404);
    const body = transferBody(L1(), L2(), productA, 2);
    const first = await session.post('/inventory/transfers', body).expect(201);
    const retry = await session.post('/inventory/transfers', body).expect(200);
    expect(retry.body).toEqual(first.body);
    expect((await session.post('/inventory/transfers', { ...body, lines: [{ productId: productA, quantity: 3 }] }).expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await stockOf(admin, a.id, L2(), productA)).toBe(2);
    expect((await auditRows(admin, a.id)).filter((row) => row.type === 'inventory_transfer_recorded')).toHaveLength(1);
  });
});

describe('POST /inventory/documents/:id/reversal', () => {
  it('reverses an entry: opposite lines, stock and average back to before, audited, once', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    const wrong = await recordEntry(session, L1(), productA, 10, 300);
    const body = reversalBody(uuidv7(), 'Costo mal cargado');
    const res = await session.post(`/inventory/documents/${wrong.id}/reversal`, body).expect(201);
    const doc = InventoryDocument.parse(res.body);
    expect(doc).toMatchObject({
      id: body.id,
      kind: 'reversal',
      locationId: L1(),
      targetLocationId: null,
      reversesDocumentId: wrong.id,
      notes: 'Costo mal cargado',
      movements: [{ locationId: L1(), kind: 'reversal', quantityDelta: -10, unitCost: { amount: 300, currency: 'CUP' }, reversesMovementId: wrong.movements[0]!.id }],
    });
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(100);
    const audit = (await auditRows(admin, a.id)).filter((row) => row.type === 'inventory_document_reversed');
    expect(audit).toEqual([
      { type: 'inventory_document_reversed', actor_user_id: a.owner, target_id: body.id, metadata: { reversesDocumentId: wrong.id, locationIds: [L1()], lineCount: 1 } },
    ]);
    // The same request again is an idempotent retry; a new id is ALREADY_REVERSED.
    expect((await session.post(`/inventory/documents/${wrong.id}/reversal`, body).expect(200)).body).toEqual(res.body);
    expect((await session.post(`/inventory/documents/${wrong.id}/reversal`, reversalBody()).expect(409)).body.error.code).toBe('ALREADY_REVERSED');
    // A reversal cannot be reversed either.
    expect((await session.post(`/inventory/documents/${body.id}/reversal`, reversalBody()).expect(409)).body.error.code).toBe('ALREADY_REVERSED');
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(3);
    await ledgerIsConsistent();
  });

  it('an entry whose stock was already consumed cannot be reversed: 409 INSUFFICIENT_STOCK, nothing written', async () => {
    const session = await owner();
    const entry = await recordEntry(session, L1(), productA, 10, 100);
    await session.post('/inventory/exits', exitBody(L1(), productA, 4)).expect(201);
    const before = await snapshot();
    const res = await session.post(`/inventory/documents/${entry.id}/reversal`, reversalBody()).expect(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: [{ path: productA }] });
    expect(await snapshot()).toEqual(before);
  });

  it("reversing a transfer restores both locations; the destination's cost is as if it never happened, the origin's unchanged", async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    await recordEntry(session, L2(), productA, 10, 300);
    const transfer = await recordTransfer(session, L1(), L2(), productA, 5);
    await recordEntry(session, L2(), productA, 5, 400);
    const originCost = await averageCostOf(admin, a.id, L1(), productA);

    const res = await session.post(`/inventory/documents/${transfer.id}/reversal`, reversalBody()).expect(201);
    expect(InventoryDocument.parse(res.body).movements.map((m) => [m.locationId, m.quantityDelta])).toEqual([
      [L1(), 5],
      [L2(), -5],
    ]);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
    expect(await stockOf(admin, a.id, L2(), productA)).toBe(15);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(originCost);
    // Without the transfer, L2 had 10 at 300 and then 5 at 400.
    expect(await averageCostOf(admin, a.id, L2(), productA)).toBeCloseTo(blendAverageCost(10, 300, 5, 400), 6);
    await ledgerIsConsistent();
  });

  it("needs the original's permission in every location it touched; another tenant's document is a 404", async () => {
    const session = await owner();
    const entry = await recordEntry(session, L1(), productA, 10, 100);
    const transfer = await recordTransfer(session, L1(), L2(), productA, 2);
    const manager = await managerAt('m1@a.example', [L1()]);
    await manager.post(`/inventory/documents/${transfer.id}/reversal`, reversalBody()).expect(403);
    await seeder.user(a.id, 'c@a.example', [[a.roles.cashier, 'tenant']]);
    const cashier = await loginAs(app, 'c@a.example');
    await cashier.post(`/inventory/documents/${entry.id}/reversal`, reversalBody()).expect(403);
    const ownerB = await loginAs(app, 'owner@b.example');
    expect((await ownerB.post(`/inventory/documents/${entry.id}/reversal`, reversalBody()).expect(404)).body.error.code).toBe('NOT_FOUND');
    await session.post(`/inventory/documents/${uuidv7()}/reversal`, reversalBody()).expect(404);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(2);
    // The Manager of L1 can reverse what only touched L1.
    await manager.post(`/inventory/documents/${entry.id}/reversal`, reversalBody()).expect(409); // authorized, but 2 of its 10 already left with the transfer
    const both = await managerAt('m12@a.example', [L1(), L2()]);
    await both.post(`/inventory/documents/${transfer.id}/reversal`, reversalBody()).expect(201);
    await manager.post(`/inventory/documents/${entry.id}/reversal`, reversalBody()).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
    await ledgerIsConsistent();
  });

  it('reverses an exit on an archived location and product (a correction can always put stock back)', async () => {
    const session = await owner();
    await recordEntry(session, L1(), productA, 10, 100);
    const exit = InventoryDocument.parse((await session.post('/inventory/exits', exitBody(L1(), productA, 3)).expect(201)).body);
    await admin.query('update locations set archived_at = now() where id = $1', [L1()]);
    await admin.query('update products set archived_at = now() where id = $1', [productA]);
    await session.post(`/inventory/documents/${exit.id}/reversal`, reversalBody()).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(100);
  });
});
