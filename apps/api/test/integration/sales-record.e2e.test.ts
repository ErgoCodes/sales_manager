import { PERMISSIONS } from '@monaco/contracts';
import { saleLineAmounts } from '@monaco/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import type { AdminRequest } from '../../src/modules/iam/application/admin-support';
import { effectivePermissions } from '../../src/modules/iam/domain/permissions';
import type { Assignment } from '../../src/modules/iam/domain/types';
import { IdempotencyConflict, InsufficientStock } from '../../src/modules/inventory/domain/inventory-errors';
import { RecordSale } from '../../src/modules/sales/application/record-sale.use-case';
import type { RecordSaleCommand } from '../../src/modules/sales/domain/sale-command';
import { auditRows, loginAs, resetAll, type SeededTenant, type Session, Seeder } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';
import { averageCostOf, countRows, exitBody, insertProduct, recordEntry, stockOf } from './inventory-fixtures';
import { movementsOutsideDocumentLocations, salesOutsideTheirDocuments } from './inventory-invariants';

/*
 * RecordSale against Postgres as monaco_app (SP4 · T5). No HTTP route writes sales in SP4,
 * so the use case is taken from the real application (same DATABASE pool as the inventory
 * routes) and called with the demo Owner's actor, like the seed will. Inventory entries
 * and exits go through HTTP, so sales and exits really compete for the same pairs.
 */

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let owner: Session;
let recordSale: RecordSale;
let productA: string;
let productB: string;

beforeAll(async () => {
  admin = adminPool();
  seeder = new Seeder(admin);
  app = await createAuthApp();
  app.getHttpServer().setMaxListeners(0);
  recordSale = app.get(RecordSale);
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

/** The tenant Owner as the AuthGuard would resolve it (the seed uses this actor). */
function ownerRequest(): AdminRequest {
  const assignments: Assignment[] = [{ role: { id: a.roles.owner, key: 'owner', isSystem: true, permissions: PERMISSIONS }, scope: { type: 'tenant' } }];
  return {
    actor: { userId: a.owner, tenantId: a.id, deviceId: uuidv7(), sessionId: uuidv7(), mustChangePassword: false, assignments, effective: effectivePermissions(assignments) },
    ip: '203.0.113.9',
  };
}

const cup = (amount: number) => ({ amount, currency: 'CUP' as const });
const saleLine = (productId: string, quantity: number, unitPrice: number, overrides: Partial<RecordSaleCommand['lines'][number]> = {}) => ({
  productId,
  quantity,
  unitPrice: cup(unitPrice),
  discountPercent: 0,
  paymentMethod: 'cash' as const,
  isCostSale: false,
  ...overrides,
});
const saleCommand = (lines: RecordSaleCommand['lines'], id = uuidv7()): RecordSaleCommand => ({ id, locationId: L1(), lines });

async function saleRows(saleId: string) {
  const { rows } = await admin.query<Record<string, unknown>>(
    `select product_id, location_id, occurred_at, cashier_user_id, currency, quantity::text, unit_price::text, discount_percent::text,
            payment_method, is_cost_sale, unit_cost::text, line_total::text, profit::text
     from sale_lines where sale_id = $1 order by product_id`,
    [saleId],
  );
  return rows;
}

async function count(table: 'sales' | 'sale_lines'): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from ${table} where tenant_id = $1`, [a.id]);
  return rows[0]!.n;
}

/** The ledger and sales invariants hold for everything written so far. */
async function expectInvariants() {
  expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
  expect(await salesOutsideTheirDocuments(admin)).toEqual([]);
}

describe('RecordSale writes the sale into the ledger', () => {
  it('lowers the derived stock and stores the amounts the domain computes, under the pair lock', async () => {
    await recordEntry(owner, L1(), productA, 10, 100);
    // B: an entry at cost 0 leaves its average at 0, so the cost price (40) applies (D2).
    await admin.query(`update products set cost_price = 40 where id = $1`, [productB]);
    await recordEntry(owner, L1(), productB, 5, 0);
    const command = saleCommand([
      saleLine(productA, 2.5, 133, { discountPercent: 5, paymentMethod: 'transfer' }),
      saleLine(productB, 2, 40, { isCostSale: true }),
    ]);
    const occurredAt = new Date(Date.now() - 60_000);
    const { sale, created } = await recordSale.execute(ownerRequest(), { ...command, occurredAt: occurredAt.toISOString() });

    expect(created).toBe(true);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(7.5);
    expect(await stockOf(admin, a.id, L1(), productB)).toBe(3);
    // A sale does not move the average cost.
    expect(await averageCostOf(admin, a.id, L1(), productA)).toBe(100);

    const amountsA = saleLineAmounts({ quantity: 2.5, unitPrice: 133, unitCost: 100, isCostSale: false });
    const amountsB = saleLineAmounts({ quantity: 2, unitPrice: 40, unitCost: 40, isCostSale: true });
    expect(amountsA).toEqual({ lineTotal: 333, profit: 83 });
    const common = { location_id: L1(), occurred_at: occurredAt, cashier_user_id: a.owner, currency: 'CUP' };
    const expected = [
      { ...common, product_id: productA, quantity: '2.500', unit_price: '133', discount_percent: '5.00', payment_method: 'transfer', is_cost_sale: false, unit_cost: '100.000000', line_total: String(amountsA.lineTotal), profit: amountsA.profit.toFixed(6) },
      { ...common, product_id: productB, quantity: '2.000', unit_price: '40', discount_percent: '0.00', payment_method: 'cash', is_cost_sale: true, unit_cost: '40.000000', line_total: String(amountsB.lineTotal), profit: amountsB.profit.toFixed(6) },
    ].sort((x, y) => (x.product_id < y.product_id ? -1 : 1));
    expect(await saleRows(command.id)).toEqual(expected);

    const { rows: movements } = await admin.query(
      `select product_id, kind, quantity_delta::text, unit_cost::text from inventory_movements where document_id = $1 order by product_id`,
      [command.id],
    );
    expect(movements).toEqual(
      [
        { product_id: productA, kind: 'sale', quantity_delta: '-2.500', unit_cost: '100.000000' },
        { product_id: productB, kind: 'sale', quantity_delta: '-2.000', unit_cost: '40.000000' },
      ].sort((x, y) => (x.product_id < y.product_id ? -1 : 1)),
    );
    const { rows: documents } = await admin.query(`select kind, location_id, occurred_at, created_by from inventory_documents where id = $1`, [command.id]);
    expect(documents).toEqual([{ kind: 'sale', location_id: L1(), occurred_at: occurredAt, created_by: a.owner }]);
    expect(sale).toMatchObject({ id: command.id, locationId: L1(), cashierUserId: a.owner, deviceId: null, occurredAt });
    expect(sale.lines.map((l) => [l.productId, l.lineTotal, l.profit])).toEqual(expected.map((l) => [l.product_id, Number(l.line_total), Number(l.profit)]));

    const audit = (await auditRows(admin, a.id)).filter((row) => row.type === 'sale_recorded');
    expect(audit).toEqual([{ type: 'sale_recorded', actor_user_id: a.owner, target_id: command.id, metadata: { locationId: L1(), lineCount: 2 } }]);
    await expectInvariants();
  });

  it('the same id and content gives the same result; other content gives IDEMPOTENCY_CONFLICT', async () => {
    await recordEntry(owner, L1(), productA, 10, 100);
    const command = saleCommand([saleLine(productA, 3, 150)]);
    const first = await recordSale.execute(ownerRequest(), command);
    const retry = await recordSale.execute(ownerRequest(), command);
    expect(retry).toEqual({ sale: first.sale, created: false });
    await expect(recordSale.execute(ownerRequest(), { ...command, lines: [saleLine(productA, 4, 150)] })).rejects.toBeInstanceOf(IdempotencyConflict);
    // An inventory document id is not reusable as a sale either.
    const exitId = uuidv7();
    await owner.post('/inventory/exits', exitBody(L1(), productA, 1, exitId)).expect(201);
    await expect(recordSale.execute(ownerRequest(), saleCommand([saleLine(productA, 1, 150)], exitId))).rejects.toBeInstanceOf(IdempotencyConflict);

    expect(await stockOf(admin, a.id, L1(), productA)).toBe(6);
    expect([await count('sales'), await count('sale_lines')]).toEqual([1, 1]);
    expect((await auditRows(admin, a.id)).filter((row) => row.type === 'sale_recorded')).toHaveLength(1);
    await expectInvariants();
  });

  it('two concurrent submissions of the same sale create it once', async () => {
    await recordEntry(owner, L1(), productA, 10, 100);
    const command = saleCommand([saleLine(productA, 3, 150)]);
    const results = await Promise.all([recordSale.execute(ownerRequest(), command), recordSale.execute(ownerRequest(), command)]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0]!.sale).toEqual(results[1]!.sale);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(7);
    await expectInvariants();
  });

  it('a sale that does not fit: INSUFFICIENT_STOCK and no effect at all', async () => {
    await recordEntry(owner, L1(), productA, 2, 100);
    await recordEntry(owner, L1(), productB, 5, 100);
    const before = [await countRows(admin, 'inventory_documents', a.id), await countRows(admin, 'inventory_movements', a.id), (await auditRows(admin, a.id)).length];
    const error = await recordSale
      .execute(ownerRequest(), saleCommand([saleLine(productB, 1, 150), saleLine(productA, 3, 150)]))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientStock);
    expect((error as InsufficientStock).shortages).toEqual([{ productId: productA, available: 2, shortBy: 1 }]);
    expect([await countRows(admin, 'inventory_documents', a.id), await countRows(admin, 'inventory_movements', a.id), (await auditRows(admin, a.id)).length]).toEqual(before);
    expect([await count('sales'), await count('sale_lines')]).toEqual([0, 0]);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(2);
    expect(await stockOf(admin, a.id, L1(), productB)).toBe(5);
  });
});

/** Polls pg_stat_activity until `count` backends wait on a lock while running a query that matches `pattern`. */
async function waitForLockWaiters(pattern: string, waiters: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1 and pid <> pg_backend_pid()`,
      [pattern],
    );
    if (rows[0]!.n >= waiters) return;
    if (attempt > 400) throw new Error(`Never saw ${waiters} backend(s) waiting on ${pattern}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Holds `FOR UPDATE` on the given pairs while `work` starts, and only releases it once `waiters`
 * transactions are queued on the pair lock: every one of them is past its header and parent locks
 * when the first proceeds, so the race happens every run instead of by luck. `waiters` stays
 * under the API pool size (10), or the rest would queue on the pool instead of on the lock.
 */
async function raceOnPairs<T>(pairs: { locationId: string; productId: string }[], waiters: number, work: () => Promise<T>): Promise<T> {
  const client: PoolClient = await admin.connect();
  try {
    await client.query('begin');
    for (const pair of pairs) {
      await client.query(`select 1 from location_products where location_id = $1 and product_id = $2 for update`, [pair.locationId, pair.productId]);
    }
    const pending = work();
    try {
      await waitForLockWaiters('%from location_products lp%for update of lp%', waiters);
    } finally {
      // Never hand a connection back to the pool inside the transaction that holds the locks.
      await client.query('commit');
    }
    return await pending;
  } finally {
    client.release();
  }
}

const settled = async <T>(promise: Promise<T>) => promise.then(() => 'ok', (e: unknown) => (e instanceof Error ? e.name : String(e)));

describe('sales and inventory exits on the same pair, under real concurrency', () => {
  it('together exceeding the stock: exactly the ones that fit succeed, stock ends at 0, no deadlock', async () => {
    await recordEntry(owner, L1(), productA, 10, 100);
    const pair = { locationId: L1(), productId: productA };
    const outcomes = await raceOnPairs([pair], 8, () =>
      Promise.all([
        ...Array.from({ length: 4 }, () => settled(recordSale.execute(ownerRequest(), saleCommand([saleLine(productA, 2, 150)])))),
        ...Array.from({ length: 4 }, () => owner.post('/inventory/exits', exitBody(L1(), productA, 2)).then((r) => (r.status === 201 ? 'ok' : `${r.status} ${r.body.error?.code}`))),
      ]),
    );
    // 10 in stock, 2 each: five of the eight fit, whatever the order; the rest find nothing left.
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(5);
    expect(outcomes.filter((o) => o !== 'ok').every((o) => o === 'InsufficientStock' || o === '409 INSUFFICIENT_STOCK')).toBe(true);
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(0);
    const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from inventory_documents where tenant_id = $1 and kind in ('sale', 'exit')`, [a.id]);
    expect(rows[0]!.n).toBe(5);
    expect(await count('sales')).toBe(outcomes.slice(0, 4).filter((o) => o === 'ok').length);
    await expectInvariants();
  });

  it('sales and exits listing two products in opposite orders never deadlock (one global lock order)', async () => {
    await recordEntry(owner, L1(), productA, 100, 10);
    await recordEntry(owner, L1(), productB, 100, 10);
    const order = (i: number) => (i % 2 === 0 ? [productA, productB] : [productB, productA]);
    const pairs = [productA, productB].map((productId) => ({ locationId: L1(), productId }));
    const outcomes = await raceOnPairs(pairs, 8, () =>
      Promise.all([
        ...Array.from({ length: 4 }, (_, i) => settled(recordSale.execute(ownerRequest(), saleCommand(order(i).map((p) => saleLine(p, 1, 20)))))),
        ...Array.from({ length: 4 }, (_, i) =>
          owner
            .post('/inventory/exits', { id: uuidv7(), locationId: L1(), reason: 'shrinkage', lines: order(i + 1).map((productId) => ({ productId, quantity: 1 })) })
            .then((r) => (r.status === 201 ? 'ok' : `${r.status} ${r.body.error?.code}`)),
        ),
      ]),
    );
    expect(outcomes).toEqual(Array(8).fill('ok'));
    expect(await stockOf(admin, a.id, L1(), productA)).toBe(92);
    expect(await stockOf(admin, a.id, L1(), productB)).toBe(92);
    expect([await count('sales'), await count('sale_lines')]).toEqual([4, 8]);
    await expectInvariants();
  });
});
