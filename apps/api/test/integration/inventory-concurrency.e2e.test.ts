import { InventoryDocument } from '@monaco/contracts';
import { blendAverageCost } from '@monaco/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { loginAs, resetAll, type SeededTenant, type Session, Seeder } from './admin-fixtures';
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
  recordTransfer,
  reversalBody,
  stockOf,
} from './inventory-fixtures';
import { movementsOutsideDocumentLocations } from './inventory-invariants';

/*
 * ADR 0006 under real concurrency: every request below runs in its own
 * transaction on the pooled connections of the API (READ COMMITTED, monaco_app).
 * They are meant to be run repeatedly (see the "20 runs" in the T5a report).
 */

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let owner: Session;
let productA: string;
let productB: string;

beforeAll(async () => {
  admin = adminPool();
  seeder = new Seeder(admin);
  app = await createAuthApp();
  // Supertest binds the server once per parallel request; that is the point of these tests.
  app.getHttpServer().setMaxListeners(0);
});
afterAll(async () => {
  await app.close();
  await resetAll(admin);
  await admin.end();
});
beforeEach(async () => {
  await resetAll(admin);
  a = await seeder.tenant('a');
  productA = await insertProduct(admin, a.id, 'Arroz');
  productB = await insertProduct(admin, a.id, 'Frijol');
  owner = await loginAs(app, 'owner@a.example');
});

const L1 = () => a.locations[0];
const L2 = () => a.locations[1];
const statuses = (responses: { status: number }[]) => responses.map((r) => r.status).sort((x, y) => x - y);
/** Status plus error code: a failure shows which error came back, not just 409. */
const outcomes = (responses: { status: number; body: { error?: { code?: string } } }[]) =>
  responses.map((r) => (r.status < 400 ? String(r.status) : `${r.status} ${r.body.error?.code}`)).sort();

describe('concurrent writes keep the stock non-negative', () => {
  it('N exits that together exceed the stock: exactly the ones that fit succeed', async () => {
    await recordEntry(owner, L1(), productA, 10, 100);
    const responses = await Promise.all(Array.from({ length: 8 }, () => owner.post('/inventory/exits', exitBody(L1(), productA, 3))));
    // 10 in stock, 3 per exit: three fit (9), five find 1 left.
    expect(statuses(responses)).toEqual([201, 201, 201, 409, 409, 409, 409, 409]);
    for (const res of responses.filter((r) => r.status === 409)) expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(1);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(4);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
  });

  it('exits and negative adjustments compete for the same stock', async () => {
    await recordEntry(owner, L1(), productA, 6, 100);
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, () => owner.post('/inventory/exits', exitBody(L1(), productA, 2, uuidv7(), 'owner_withdrawal'))),
      ...Array.from({ length: 4 }, () => owner.post('/inventory/adjustments', adjustmentBody(L1(), productA, -2))),
    ]);
    expect(statuses(responses)).toEqual([201, 201, 201, 409, 409, 409, 409, 409]);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
  });

  it('documents that list the same products in opposite orders never deadlock (locks are sorted)', async () => {
    await recordEntry(owner, L1(), productA, 1000, 10);
    await recordEntry(owner, L1(), productB, 1000, 10);
    const body = (order: string[]) => ({
      id: uuidv7(),
      locationId: L1(),
      reason: 'shrinkage',
      lines: order.map((productId) => ({ productId, quantity: 1 })),
    });
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, i) => owner.post('/inventory/exits', body(i % 2 === 0 ? [productA, productB] : [productB, productA]))),
    );
    expect(statuses(responses)).toEqual(Array(24).fill(201));
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(976);
    expect(await stockOf(admin, a.id, L1(), productB)).toBe(976);
  });

  it('concurrent entries of the same product give the weighted average of all of them', async () => {
    const costs = [100, 200, 300, 400, 500];
    const responses = await Promise.all(costs.map((cost) => owner.post('/inventory/entries', entryBody(L1(), productA, 10, cost))));
    expect(statuses(responses)).toEqual(Array(5).fill(201));
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(50);
    // Blending is associative while stock stays positive, so any commit order gives the same result.
    const expected = costs.reduce((average, cost, index) => blendAverageCost(index * 10, average, 10, cost), 0);
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBeCloseTo(expected, 4);
    expect(expected).toBeCloseTo(300, 6);
  });
});

describe('concurrent submissions of the same id', () => {
  it('two identical requests create one document: one 201, one 200 with the same body', async () => {
    const body = entryBody(L1(), productA, 10, 100);
    const [first, second] = await Promise.all([owner.post('/inventory/entries', body), owner.post('/inventory/entries', body)]);
    expect(outcomes([first, second])).toEqual(['200', '201']);
    expect(InventoryDocument.parse(first.body)).toEqual(InventoryDocument.parse(second.body));
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(1);
    expect(await countRows(admin, 'inventory_movements', a.id)).toBe(1);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
  });

  it('many identical requests in parallel still create a single document', async () => {
    const body = entryBody(L1(), productA, 3, 100);
    const responses = await Promise.all(Array.from({ length: 6 }, () => owner.post('/inventory/entries', body)));
    expect(outcomes(responses)).toEqual(['200', '200', '200', '200', '200', '201']);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(3);
  });

  it('stress: 40 rounds of 3 identical submissions never surface a conflict', async () => {
    // Regression: `on conflict (id)` let the loser trip the (id, tenant_id) unique index (23505 -> 409).
    for (let round = 0; round < 40; round++) {
      const body = entryBody(L1(), productA, 1, 10);
      const responses = await Promise.all([1, 2, 3].map(() => owner.post('/inventory/entries', body)));
      expect(outcomes(responses)).toEqual(['200', '200', '201']);
    }
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(40);
  });

  it('the same id with different content in parallel: one wins, the other is IDEMPOTENCY_CONFLICT', async () => {
    const id = uuidv7();
    const [one, two] = await Promise.all([
      owner.post('/inventory/entries', entryBody(L1(), productA, 10, 100, id)),
      owner.post('/inventory/entries', entryBody(L1(), productA, 99, 100, id)),
    ]);
    expect(statuses([one, two])).toEqual([201, 409]);
    expect([one, two].find((r) => r.status === 409)!.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(1);
    expect([10, 99]).toContain(await stockOf(admin, a.id, L1(), productA));
  });

  it('a failed first attempt does not poison the id: the retry that fits succeeds', async () => {
    const id = uuidv7();
    await owner.post('/inventory/exits', exitBody(L1(), productA, 5, id)).expect(409);
    await recordEntry(owner, L1(), productA, 5, 10);
    await owner.post('/inventory/exits', exitBody(L1(), productA, 5, id)).expect(201);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
  });
});

/** Polls pg_stat_activity until `count` backends wait on a lock while running a query that matches `pattern`. */
async function waitForLockWaiters(pattern: string, count: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1 and pid <> pg_backend_pid()`,
      [pattern],
    );
    if (rows[0]!.n >= count) return;
    if (attempt > 400) throw new Error(`Never saw ${count} backend(s) waiting on ${pattern}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('transfers in both directions (global lock order)', () => {
  it('simultaneous A->B and B->A transfers of the same products never deadlock and leave the right stock', async () => {
    for (const product of [productA, productB]) {
      await recordEntry(owner, L1(), product, 100, 10);
      await recordEntry(owner, L2(), product, 100, 30);
    }
    // Opposite directions and opposite line orders: without one global order these would deadlock.
    const forward = () => ({ id: uuidv7(), fromLocationId: L1(), toLocationId: L2(), lines: [{ productId: productA, quantity: 2 }, { productId: productB, quantity: 2 }] });
    const backward = () => ({ id: uuidv7(), fromLocationId: L2(), toLocationId: L1(), lines: [{ productId: productB, quantity: 1 }, { productId: productA, quantity: 1 }] });
    const responses = await Promise.all(Array.from({ length: 24 }, (_, i) => owner.post('/inventory/transfers', i % 2 === 0 ? forward() : backward())));
    expect(outcomes(responses)).toEqual(Array(24).fill('201'));
    for (const product of [productA, productB]) {
      expect(await stockOf(admin, a.id, L1(), product)).toBe(100 - 12 * 2 + 12 * 1);
      expect(await stockOf(admin, a.id, L2(), product)).toBe(100 + 12 * 2 - 12 * 1);
    }
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(4 + 24);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
  });

  it('transfers that together exceed the origin stock: exactly the ones that fit move, both ends stay consistent', async () => {
    await recordEntry(owner, L1(), productA, 10, 10);
    const responses = await Promise.all(Array.from({ length: 6 }, () => owner.post('/inventory/transfers', { id: uuidv7(), fromLocationId: L1(), toLocationId: L2(), lines: [{ productId: productA, quantity: 3 }] })));
    expect(outcomes(responses)).toEqual(['201', '201', '201', '409 INSUFFICIENT_STOCK', '409 INSUFFICIENT_STOCK', '409 INSUFFICIENT_STOCK']);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(1);
    expect(await stockOf(admin, a.id, L2(), productA)).toBe(9);
  });
});

describe('concurrent reversals of the same document', () => {
  it('two reversals with different ids in parallel: one passes, the other is ALREADY_REVERSED (10 rounds)', async () => {
    for (let round = 0; round < 10; round++) {
      const entry = await recordEntry(owner, L1(), productA, 5, 10);
      const responses = await Promise.all([1, 2].map(() => owner.post(`/inventory/documents/${entry.id}/reversal`, reversalBody())));
      expect(outcomes(responses)).toEqual(['201', '409 ALREADY_REVERSED']);
    }
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(20);
  });

  it('a reversal queued behind the uncommitted header of another (the unique index race) is ALREADY_REVERSED, not IDEMPOTENCY_CONFLICT', async () => {
    await recordEntry(owner, L1(), productA, 10, 10);
    const transfer = await recordTransfer(owner, L1(), L2(), productA, 4);
    const client = await admin.connect();
    try {
      // Hold the destination pair: the first reversal inserts its header, then waits here.
      await client.query('begin');
      await client.query('select 1 from location_products where tenant_id = $1 and location_id = $2 and product_id = $3 for update', [a.id, L2(), productA]);
      const first = Promise.resolve(owner.post(`/inventory/documents/${transfer.id}/reversal`, reversalBody()));
      await waitForLockWaiters('%from location_products lp%for update of lp%', 1);
      // The second one now waits on the first's uncommitted (tenant_id, reverses_document_id) entry.
      const second = Promise.resolve(owner.post(`/inventory/documents/${transfer.id}/reversal`, reversalBody()));
      await waitForLockWaiters('%insert into inventory_documents%', 1);
      await client.query('commit');
      expect(outcomes([await first, await second])).toEqual(['201', '409 ALREADY_REVERSED']);
    } finally {
      client.release();
    }
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(10);
    expect(await stockOf(admin, a.id, L2(), productA)).toBe(0);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
  });

  it('a reversal and an exit racing for the same stock: never below zero', async () => {
    for (let round = 0; round < 5; round++) {
      const entry = await recordEntry(owner, L1(), productA, 5, 10);
      const [reversal, exit] = await Promise.all([
        owner.post(`/inventory/documents/${entry.id}/reversal`, reversalBody()),
        owner.post('/inventory/exits', exitBody(L1(), productA, 5)),
      ]);
      // Whichever commits first takes the 5 units; the other finds 0.
      expect(outcomes([reversal, exit])).toEqual(['201', '409 INSUFFICIENT_STOCK']);
      expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
    }
  });
});

describe('a concurrent archive serializes with the document (FOR SHARE)', () => {
  it('an entry waits for an archive of its location that holds the row, then gets ARCHIVED', async () => {
    const client = await admin.connect();
    try {
      await client.query('begin');
      await client.query('update locations set archived_at = now() where id = $1', [L1()]);
      // supertest only sends the request once it is awaited: Promise.resolve() starts it now.
      const pending = Promise.resolve(owner.post('/inventory/entries', entryBody(L1(), productA, 1, 10)));
      // The request must be blocked on the location row, not racing past it.
      for (let attempt = 0; ; attempt++) {
        await client.query('select pg_stat_clear_snapshot()');
        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%from locations%for share%' and pid <> pg_backend_pid()`,
        );
        if (rows[0]!.n >= 1) break;
        if (attempt > 200) throw new Error('The entry never queued on the location row');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await client.query('commit');
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ARCHIVED');
    } finally {
      client.release();
    }
    expect(await countRows(admin, 'inventory_documents', a.id)).toBe(0);
  });
});
