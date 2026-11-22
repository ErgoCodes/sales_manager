import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/db/database';
import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import type { AuthenticatedActor } from '../../src/modules/iam/domain/actor';
import { effectivePermissions } from '../../src/modules/iam/domain/permissions';
import { SYSTEM_ROLES } from '../../src/modules/iam/domain/system-roles';
import {
  GetDailySeries,
  GetInventoryHealth,
  GetReportSummary,
  GetSummaryByLocation,
  GetTopProducts,
} from '../../src/modules/reports/application/reports.use-cases';
import { DrizzleReportsUnitOfWork } from '../../src/modules/reports/infrastructure/drizzle-reports-unit-of-work';
import { loginAs, resetAll, type SeededTenant, Seeder, Session } from './admin-fixtures';
import { createAuthApp, freshIp } from './auth-fixtures';
import { adminPool, appDatabase } from './helpers';
import { seedReportVolume } from './reports-volume';
import { SalesFixtures } from './sales-fixtures';

/*
 * Performance budget of the reports (SP4 spec, "Presupuesto de rendimiento"; ADR 0007 §6):
 * with 10× the demo volume (≈ 200 000 sale lines over 90 days, 2 locations, 40 products),
 * every endpoint answers in p95 < 300 ms in the integration container, and EXPLAIN shows
 * no Seq Scan on sale_lines or inventory_movements. Asserted for the dashboard periods up
 * to 30 days (latency) and up to 7 days (plans); the longer ranges are measured and
 * recorded, with the gap documented in ADR 0007. The documented way out is the daily
 * projection of ADR 0007 or a covering index, never a cache.
 */

const RUNS = 20;
const BUDGET_MS = 300;
const BIG_TABLES = ['sale_lines', 'inventory_movements'];
const dialect = new PgDialect();

let app: NestExpressApplication;
let admin: Pool;
let fx: SalesFixtures;
let tenant: SeededTenant;
let owner: Session;

beforeAll(async () => {
  admin = adminPool();
  fx = new SalesFixtures();
  app = await createAuthApp();
  await resetAll(admin);
  tenant = await new Seeder(admin).tenant('perf');
  const lines = await seedReportVolume(admin, fx, tenant);
  expect(lines).toBeGreaterThan(190_000);
  owner = await loginAs(app, `owner@perf.example`);
}, 300_000);
afterAll(async () => {
  await app.close();
  await resetAll(admin);
  await fx.end();
  await admin.end();
});

const localDay = async (offset: number) =>
  (await admin.query<{ day: string }>(`select ((now() at time zone 'America/Havana')::date + $1::int)::text as day`, [offset])).rows[0]!.day;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((x, y) => x - y);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

/** p95 per endpoint and location scope (all my locations, one location) over a range, over HTTP. */
async function measure(label: string, range: string): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  for (const location of ['', `locationId=${tenant.locations[0]}`]) {
    for (const endpoint of ['summary', 'daily-series', 'top-products', 'by-location', 'inventory-health']) {
      const query = [range, location].filter(Boolean).join('&');
      const samples: number[] = [];
      for (let run = 0; run < RUNS + 2; run++) {
        // A fresh IP per request: the ip throttler (30/min) must not shape the measurement.
        const session = new Session(app, owner.token, owner.deviceId, freshIp());
        const started = performance.now();
        await session.get(`/reports/${endpoint}?${query}`).expect(200);
        if (run >= 2) samples.push(performance.now() - started); // two warm-up runs
      }
      results[`${endpoint} ${label}${location ? ' L1' : ' all'}`] = Math.round(p95(samples));
    }
  }
  return results;
}

describe('reports at 10× the demo volume', () => {
  it(`answers every endpoint in p95 < ${BUDGET_MS} ms over HTTP for today, 7 and 30 days`, async () => {
    const today = await localDay(0);
    const results = {
      ...(await measure('today', '')),
      ...(await measure('7 days', `from=${await localDay(-6)}&to=${today}`)),
      ...(await measure('30 days', `from=${await localDay(-29)}&to=${today}`)),
    };
    console.info('reports p95 (ms):', JSON.stringify(results, null, 1));
    for (const [key, value] of Object.entries(results)) expect(value, key).toBeLessThan(BUDGET_MS);
  }, 300_000);

  // Recorded, not asserted: 90 days is the whole history of this volume (see the plans below and ADR 0007).
  it('records the p95 of a 90-day range', async () => {
    const results = await measure('90 days', `from=${await localDay(-89)}&to=${await localDay(0)}`);
    console.info('reports p95 over 90 days (ms):', JSON.stringify(results, null, 1));
    expect(Object.keys(results)).toHaveLength(10);
  }, 300_000);

  /**
   * Explains, then executes, every statement the five use cases run (Owner and a
   * view_own Cashier), on the real tenant transaction. Returns the statements that
   * plan a Seq Scan on a big table.
   */
  async function seqScansOver(from: string, to: string): Promise<{ query: string; tables: string[] }[]> {
    const { pool, db } = appDatabase();
    const plans: { query: string; tables: string[] }[] = [];
    const explaining = {
      transaction: (work: (tx: unknown) => Promise<unknown>) =>
        db.transaction((tx) =>
          work(
            new Proxy(tx, {
              get(target, property, receiver) {
                if (property !== 'execute') return Reflect.get(target, property, receiver) as unknown;
                return async (query: SQL) => {
                  const explained = await target.execute(sql`explain (format json) ${query}`);
                  const plan = (explained.rows[0] as { 'QUERY PLAN': unknown })['QUERY PLAN'];
                  plans.push({ query: dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').slice(0, 90), tables: BIG_TABLES.filter((table) => seqScanOn(plan, table)) });
                  return target.execute(query);
                };
              },
            }),
          ),
        ),
    } as unknown as Database;
    const actorWith = (role: keyof typeof SYSTEM_ROLES, scope: { type: 'tenant' } | { type: 'locations'; locationIds: string[] }): AuthenticatedActor => ({
      userId: tenant.owner,
      tenantId: tenant.id,
      deviceId: uuidv7(),
      sessionId: uuidv7(),
      mustChangePassword: false,
      assignments: [],
      effective: effectivePermissions([{ role: { id: role, key: role, isSystem: true, permissions: SYSTEM_ROLES[role].permissions }, scope }]),
    });
    try {
      const uow = new DrizzleReportsUnitOfWork(explaining);
      const owner = actorWith('owner', { type: 'tenant' });
      const cashier = actorWith('cashier', { type: 'locations', locationIds: [tenant.locations[0]] });
      for (const locationId of [undefined, tenant.locations[0]]) {
        const query = { from, to, ...(locationId ? { locationId } : {}) };
        await new GetReportSummary(uow).execute(owner, query);
        await new GetDailySeries(uow).execute(owner, query);
        await new GetTopProducts(uow).execute(owner, { ...query, by: 'profit', limit: 10 });
        await new GetSummaryByLocation(uow).execute(owner, query);
        await new GetInventoryHealth(uow).execute(owner, locationId ? { locationId } : {});
      }
      await new GetReportSummary(uow).execute(cashier, { from, to, locationId: tenant.locations[0] });
    } finally {
      await pool.end();
    }
    expect(plans.length).toBeGreaterThan(25);
    return plans.filter((plan) => plan.tables.length > 0);
  }

  it('plans no Seq Scan on sale_lines or inventory_movements for today and the last 7 days', async () => {
    expect(await seqScansOver(await localDay(0), await localDay(0))).toEqual([]);
    expect(await seqScansOver(await localDay(-6), await localDay(0))).toEqual([]);
  }, 120_000);

  /*
   * Recorded, not asserted (ADR 0007, "Resultados medidos"): over 30 days (a third of this
   * volume) the ranking reads product_id and quantity, which sale_lines_kpi_idx does not
   * include, so the planner prefers a Seq Scan; over 90 days (the whole history) every
   * sale_lines aggregate does, which is the cheapest plan for reading the whole table.
   * Closing it needs a covering index (a migration, outside T6) or the daily projection.
   */
  it('records the plans of the 30- and 90-day ranges', async () => {
    const found = {
      '30 days': await seqScansOver(await localDay(-29), await localDay(0)),
      '90 days': await seqScansOver(await localDay(-89), await localDay(0)),
    };
    console.info('reports Seq Scans:', JSON.stringify(found, null, 1));
    expect(found['30 days'].flatMap((plan) => plan.tables)).not.toContain('inventory_movements');
  }, 120_000);
});

/** True if any node of the JSON plan is a Seq Scan on `table`. */
function seqScanOn(plan: unknown, table: string): boolean {
  if (Array.isArray(plan)) return plan.some((node) => seqScanOn(node, table));
  if (plan === null || typeof plan !== 'object') return false;
  const node = plan as Record<string, unknown>;
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === table) return true;
  return Object.values(node).some((value) => seqScanOn(value, table));
}
