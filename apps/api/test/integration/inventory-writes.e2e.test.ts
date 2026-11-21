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
  adjustmentBody,
  averageCostOf,
  countRows,
  entryBody,
  exitBody,
  insertProduct,
  recordEntry,
  stockOf,
} from './inventory-fixtures';
import { movementsOutsideDocumentLocations } from './inventory-invariants';

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let b: SeededTenant;
let productA: string;
let productB: string;
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
  productA = await insertProduct(admin, a.id, 'Arroz');
  productB = await insertProduct(admin, a.id, 'Frijol');
  productOfB = await insertProduct(admin, b.id, 'Azúcar');
});

const [L1, L2] = [() => a.locations[0], () => a.locations[1]];
const ledgerIsConsistent = async () => expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);

describe('entries', () => {
  it('records the document, creates the pair lazily, projects the average cost and audits once', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    expect(await countRows(admin, 'location_products', a.id)).toBe(0);
    const body = { ...entryBody(L1(), productA, 10, 100), occurredAt: '2026-11-01T10:00:00.000Z', notes: 'Compra' };
    const res = await owner.post('/inventory/entries', body).expect(201);
    const doc = InventoryDocument.parse(res.body);
    expect(doc).toMatchObject({
      id: body.id,
      kind: 'entry',
      locationId: L1(),
      targetLocationId: null,
      reason: null,
      occurredAt: '2026-11-01T10:00:00.000Z',
      notes: 'Compra',
      createdBy: a.owner,
      movements: [{ productId: productA, locationId: L1(), kind: 'entry', quantityDelta: 10, unitCost: { amount: 100, currency: 'CUP' } }],
    });
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(100);
    const audit = (await auditRows(admin, a.id)).filter((row) => row.type.startsWith('inventory_'));
    expect(audit).toEqual([
      { type: 'inventory_entry_recorded', actor_user_id: a.owner, target_id: body.id, metadata: { locationId: L1(), lineCount: 1 } },
    ]);
    await ledgerIsConsistent();
  });

  it('keeps the average cost and unit costs equal to the domain after several entries and an exit', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const first = await recordEntry(owner, L1(), productA, 10, 100);
    await recordEntry(owner, L1(), productA, 10, 201);
    // Money is an integer in minor units: a fraction of a cent is rejected by the contract.
    await owner.post('/inventory/entries', entryBody(L1(), productA, 5, 180.5)).expect(400);
    await recordEntry(owner, L1(), productA, 5, 181);

    const expected = blendAverageCost(20, blendAverageCost(10, 100, 10, 201), 5, 181);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBeCloseTo(expected, 6);
    expect(first.movements[0]!.unitCost).toEqual({ amount: 100, currency: 'CUP' });

    // An exit is valued at the average cost and does not move it.
    const exit = InventoryDocument.parse((await owner.post('/inventory/exits', exitBody(L1(), productA, 3)).expect(201)).body);
    expect(exit.movements[0]!.unitCost!.amount).toBeCloseTo(expected, 6);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBeCloseTo(expected, 6);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(22);
    await ledgerIsConsistent();
  });

  it('each location has its own average cost', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), productA, 10, 100);
    await recordEntry(owner, L2(), productA, 4, 300);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(100);
    expect(await averageCostOf(admin, a.id, L2(), productA)).toBe(300);
  });

  it('is ARCHIVED for an archived location or product, and CURRENCY_MISMATCH for another currency', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const archivedProduct = await insertProduct(admin, a.id, 'Viejo', 'CUP', true);
    const usd = await insertProduct(admin, a.id, 'Importado', 'USD');
    await admin.query('update locations set archived_at = now() where id = $1', [L2()]);

    expect((await owner.post('/inventory/entries', entryBody(L2(), productA, 1, 10)).expect(409)).body.error.code).toBe('ARCHIVED');
    expect((await owner.post('/inventory/entries', entryBody(L1(), archivedProduct, 1, 10)).expect(409)).body.error.code).toBe('ARCHIVED');
    expect((await owner.post('/inventory/entries', entryBody(L1(), usd, 1, 10)).expect(422)).body.error.code).toBe('CURRENCY_MISMATCH');
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(0);
    expect(await countRows(admin, 'location_products', a.id)).toBe(0);
  });
});

describe('exits and adjustments', () => {
  it('an exit writes negative deltas of its reason kind; an adjustment keeps its sign', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), productA, 10, 100);
    const exit = InventoryDocument.parse((await owner.post('/inventory/exits', exitBody(L1(), productA, 4, uuidv7(), 'owner_withdrawal')).expect(201)).body);
    expect(exit).toMatchObject({ kind: 'exit', reason: 'owner_withdrawal', movements: [{ kind: 'owner_withdrawal', quantityDelta: -4 }] });
    await owner.post('/inventory/adjustments', adjustmentBody(L1(), productA, 2.5)).expect(201);
    await owner.post('/inventory/adjustments', adjustmentBody(L1(), productA, -1.5)).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(7);
    const types = (await auditRows(admin, a.id)).map((row) => row.type).filter((type) => type.startsWith('inventory_'));
    expect(types).toEqual(['inventory_entry_recorded', 'inventory_exit_recorded', 'inventory_adjustment_recorded', 'inventory_adjustment_recorded']);
    await ledgerIsConsistent();
  });

  it('INSUFFICIENT_STOCK reports every short product of the document and writes nothing', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), productA, 3, 100);
    const before = await countRows(admin, 'inventory_movements', a.id);
    const body = { id: uuidv7(), locationId: L1(), reason: 'shrinkage', lines: [{ productId: productA, quantity: 4 }, { productId: productB, quantity: 1 }] };
    const res = await owner.post('/inventory/exits', body).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [
        { path: productA, message: 'Available 3, short by 1' },
        { path: productB, message: 'Available 0, short by 1' },
      ],
    });
    expect(await countRows(admin, 'inventory_movements', a.id)).toBe(before);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(1);
    await owner.post('/inventory/adjustments', adjustmentBody(L1(), productA, -3.001)).expect(409);
  });

  it('0.3 can be withdrawn after entries of 0.1 and 0.2 (thousandths, not floats)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), productA, 0.1, 10);
    await recordEntry(owner, L1(), productA, 0.2, 10);
    await owner.post('/inventory/exits', exitBody(L1(), productA, 0.3)).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
  });

  it('an archived location and an archived product can be drained (D15)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await recordEntry(owner, L1(), productA, 10, 100);
    await recordEntry(owner, L1(), productB, 10, 100);
    await admin.query('update locations set archived_at = now() where id = $1', [L1()]);
    await admin.query('update products set archived_at = now() where id = $1', [productB]);
    await owner.post('/inventory/exits', exitBody(L1(), productA, 10)).expect(201);
    await owner.post('/inventory/adjustments', adjustmentBody(L1(), productB, -10)).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
    expect(await stockOf(admin, a.id, L1(), productB)).toBe(0);
    await ledgerIsConsistent();
  });

  it('rejects a future occurredAt and an unknown product, and validates the body', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const future = { ...exitBody(L1(), productA, 1), occurredAt: new Date(Date.now() + 3_600_000).toISOString() };
    expect((await owner.post('/inventory/exits', future).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    await owner.post('/inventory/exits', exitBody(L1(), uuidv7(), 1)).expect(404);
    const repeated = { ...exitBody(L1(), productA, 1), lines: [{ productId: productA, quantity: 1 }, { productId: productA, quantity: 2 }] };
    await owner.post('/inventory/exits', repeated).expect(400);
    await owner.post('/inventory/exits', { ...exitBody(L1(), productA, 0) }).expect(400);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(0);
  });
});

describe('idempotency by client id', () => {
  it('a retry returns 200 with the same document and does not duplicate stock or audit', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const body = entryBody(L1(), productA, 10, 100);
    const first = await owner.post('/inventory/entries', body).expect(201);
    const retry = await owner.post('/inventory/entries', body).expect(200);
    expect(retry.body).toEqual(first.body);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(1);
    expect((await auditRows(admin, a.id)).filter((row) => row.type === 'inventory_entry_recorded')).toHaveLength(1);
  });

  it('a retry without occurredAt a moment later is still a 200 (the hash is taken before defaults)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const body = exitBody(L1(), productA, 1);
    await recordEntry(owner, L1(), productA, 5, 10);
    await owner.post('/inventory/exits', body).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await owner.post('/inventory/exits', body).expect(200);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(4);
  });

  it('the same id with another content, or as another kind, is IDEMPOTENCY_CONFLICT', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const body = entryBody(L1(), productA, 10, 100);
    await owner.post('/inventory/entries', body).expect(201);
    expect((await owner.post('/inventory/entries', { ...body, notes: 'otra' }).expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await owner.post('/inventory/exits', exitBody(L1(), productA, 1, body.id)).expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
  });

  it("another tenant's document id is a 409 with no effect on either tenant", async () => {
    const ownerB = await loginAs(app, 'owner@b.example');
    const ownerA = await loginAs(app, 'owner@a.example');
    const docB = entryBody(b.locations[0], productOfB, 7, 50);
    await ownerB.post('/inventory/entries', docB).expect(201);

    // The same id, with A's own location and product, as an attacker probing for existence.
    const probe = await ownerA.post('/inventory/entries', entryBody(L1(), productA, 1, 10, docB.id)).expect(409);
    expect(probe.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    // Indistinguishable from a conflict inside the own tenant.
    await ownerA.post('/inventory/entries', entryBody(L1(), productA, 1, 10, uuidv7())).expect(201);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(1);
    expect(await countRows(admin, 'inventory_documents', b.id)).toBe(1);
    expect(await stockOf(admin, b.id, b.locations[0], productOfB)).toBe(7);
  });
});

describe('authorization and isolation', () => {
  it('writing in a location outside the actor scope is a 403 and touches nothing (also for a cashier)', async () => {
    await seeder.user(a.id, 'manager1@a.example', [[a.roles.manager, [L1()]]]);
    await seeder.user(a.id, 'cashier1@a.example', [[a.roles.cashier, [L1()]]]);
    const manager = await loginAs(app, 'manager1@a.example');
    const cashier = await loginAs(app, 'cashier1@a.example');

    await manager.post('/inventory/entries', entryBody(L2(), productA, 1, 10)).expect(403);
    await manager.post('/inventory/exits', exitBody(L2(), productA, 1)).expect(403);
    await manager.post('/inventory/adjustments', adjustmentBody(L2(), productA, 1)).expect(403);
    await cashier.post('/inventory/entries', entryBody(L1(), productA, 1, 10)).expect(403);
    await cashier.post('/inventory/exits', exitBody(L1(), productA, 1)).expect(403);
    await cashier.post('/inventory/adjustments', adjustmentBody(L1(), productA, 1)).expect(403);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(0);
    expect(await countRows(admin, 'location_products', a.id)).toBe(0);

    // In its own location the manager writes, and sees costs on its own document.
    const doc = InventoryDocument.parse((await manager.post('/inventory/entries', entryBody(L1(), productA, 2, 10)).expect(201)).body);
    expect(doc.movements[0]!.unitCost).toEqual({ amount: 10, currency: 'CUP' });
    expect(await auditRows(admin, a.id).then((rows) => rows.filter((row) => row.type.startsWith('inventory_')).length)).toBe(1);
  });

  it('a custom role with only inventory:write can write and gets its own document back', async () => {
    const role = await seeder.role(a.id, 'Receiver', ['inventory:write']);
    await seeder.user(a.id, 'receiver@a.example', [[role, [L1()]]]);
    const receiver = await loginAs(app, 'receiver@a.example');
    await receiver.post('/inventory/entries', entryBody(L1(), productA, 1, 10)).expect(201);
    await receiver.post('/inventory/entries', entryBody(L2(), productA, 1, 10)).expect(403);
  });

  it("another tenant's location or product is a 404 (not a 403) and writes nothing", async () => {
    const ownerA = await loginAs(app, 'owner@a.example');
    await ownerA.post('/inventory/entries', entryBody(b.locations[0], productA, 1, 10)).expect(404);
    await ownerA.post('/inventory/exits', exitBody(b.locations[0], productOfB, 1)).expect(404);
    await ownerA.post('/inventory/adjustments', adjustmentBody(L1(), productOfB, 1)).expect(404);
    await ownerA.post('/inventory/entries', entryBody(L1(), productOfB, 1, 10)).expect(404);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(0);
    expect(await countRows(admin, 'inventory_documents', b.id)).toBe(0);
    expect(await countRows(admin, 'location_products', b.id)).toBe(0);
  });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    await request(app.getHttpServer()).post('/inventory/entries').send(entryBody(L1(), productA, 1, 1)).expect(401);
  });
});
