import { AuthTokens } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import type { Clock } from '../../src/modules/iam/domain/auth-ports';
import { runDemoReset } from '../../src/scripts/demo-reset';
import { DEMO_USERS } from '../../src/scripts/demo-seed';
import { runSeed } from '../../src/scripts/seed';
import { runTenantCreate } from '../../src/scripts/tenant-create';
import { createAuthApp, freshIp, signedIpHeader } from './auth-fixtures';
import { negativeStockPairs, salesByLocalDay, salesTotal } from './demo-fixtures';
import { adminPool, resetTenants, urls } from './helpers';
import { movementsOutsideDocumentLocations, salesOutsideTheirDocuments } from './inventory-invariants';

let admin: Pool;
beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
});

/** 31 days (instead of the real 90) keep the suite fast and still cover a 30-day KPI window. */
const HISTORY_DAYS = 31;
const ENV = () => ({ DATABASE_MIGRATION_URL: urls().owner, DEMO_RESET_CONFIRM: 'demo' });
const quiet = () => undefined;
const reset = (env: Record<string, string | undefined> = ENV(), clock?: Clock) => runDemoReset(env, quiet, { historyDays: HISTORY_DAYS, clock });

const count = async (table: string): Promise<number> => Number((await admin.query(`select count(*)::int as n from ${table}`)).rows[0].n);

/** Everything a visitor could see, and the ids: a failed reset must leave exactly this. */
async function snapshot() {
  return {
    tenants: (await admin.query('select id, slug, read_only, time_zone from tenants order by id')).rows,
    users: (await admin.query('select id, email, password_hash from users order by id')).rows,
    products: await count('products'),
    documents: (await admin.query('select id from inventory_documents order by id')).rows.map((r) => r.id),
    sales: await count('sales'),
    saleLines: await count('sale_lines'),
    audit: await count('audit_events'),
    devices: await count('devices'),
  };
}

/** Tables with RLS enabled but not forced. Must stay empty: the reset lifts FORCE on `tenants` only inside its transaction. */
async function unforcedTables(): Promise<string[]> {
  const { rows } = await admin.query(
    `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity and not relforcerowsecurity order by relname`,
  );
  return rows.map((r) => r.relname);
}

describe('demo:reset refusals', () => {
  it.each([undefined, '', 'acme', 'DEMO'])('refuses without DEMO_RESET_CONFIRM=demo (got %j), before connecting', async (confirm) => {
    await expect(runDemoReset({ DEMO_RESET_CONFIRM: confirm }, quiet)).rejects.toThrow(/DEMO_RESET_CONFIRM=demo/);
  });

  it('refuses when a real tenant (read_only = false) is in the database, and leaves it untouched', async () => {
    await runTenantCreate(['--name', 'Acme Store', '--slug', 'acme', '--owner-email', 'boss@acme.example'], { DATABASE_MIGRATION_URL: urls().owner }, quiet);
    const before = await snapshot();
    await expect(reset()).rejects.toThrow(/acme.*not read-only/);
    expect(await snapshot()).toEqual(before);
    expect(await unforcedTables()).toEqual([]);
  });

  it("refuses a database seeded by db:seed (its demo tenant is writable)", async () => {
    await runSeed({ DATABASE_MIGRATION_URL: urls().owner }, quiet, ['--history-days', '1']);
    const before = await snapshot();
    await expect(reset()).rejects.toThrow(/demo.*not read-only/);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses when only one of several tenants is writable', { timeout: 120_000 }, async () => {
    await reset();
    await runTenantCreate(['--name', 'Acme Store', '--slug', 'acme', '--owner-email', 'boss@acme.example'], { DATABASE_MIGRATION_URL: urls().owner }, quiet);
    const before = await snapshot();
    await expect(reset()).rejects.toThrow(/acme/);
    expect(await snapshot()).toEqual(before);
  });
});

describe('demo:reset', () => {
  it('recreates the read-only demo tenant with its history through the use cases, in the tenant zone', { timeout: 120_000 }, async () => {
    const lines: string[] = [];
    await runDemoReset(ENV(), (line) => lines.push(line), { historyDays: HISTORY_DAYS });
    expect(lines.join('\n')).toMatch(/reset \(read-only\)/);

    expect((await admin.query('select slug, read_only, time_zone from tenants')).rows).toEqual([{ slug: 'demo', read_only: true, time_zone: 'America/Havana' }]);
    expect((await admin.query('select email from users order by email')).rows.map((r) => r.email)).toEqual(
      Object.values(DEMO_USERS).map((u) => u.email).sort(),
    );
    // Every sale went through RecordSale (its audit event) and the ledger invariants hold.
    expect((await admin.query(`select count(*)::int as n from audit_events where type = 'sale_recorded'`)).rows[0].n).toBe(await count('sales'));
    expect(await salesOutsideTheirDocuments(admin)).toEqual([]);
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
    expect(await negativeStockPairs(admin)).toEqual([]);
    // KPIs: sales on each of the last 30 local days (today included, in full) and a non-empty 30-day total cut at now().
    const days = await salesByLocalDay(admin, 30);
    expect(days).toHaveLength(30);
    for (const day of days) expect(day.locations).toBe(2);
    expect(days.at(-1)!.day).toBe((await admin.query(`select (now() at time zone 'America/Havana')::date::text as d`)).rows[0].d);
    expect(await salesTotal(admin, 30)).toBeGreaterThan(0);
    expect(await unforcedTables()).toEqual([]);
  });

  it('is repeatable: a second reset the same day empties the sessions and rebuilds the same documents with the same ids', { timeout: 120_000 }, async () => {
    // One instant for both runs, so the test never straddles local midnight.
    const instant = new Date();
    const fixed: Clock = { now: () => instant };
    await reset(ENV(), fixed);
    const first = await snapshot();

    // A visitor signs in: the read-only tenant still allows login (device + refresh family).
    const app: NestExpressApplication = await createAuthApp();
    try {
      const ip = freshIp();
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', ip))
        .send({ email: DEMO_USERS.owner.email, password: DEMO_USERS.owner.password, device: { label: 'visitor', platform: 'web' } })
        .expect(200);
      expect(AuthTokens.parse(login.body).accessToken).toBeTruthy();
    } finally {
      await app.close();
    }
    expect(await count('devices')).toBe(1);

    await reset(ENV(), fixed);
    const second = await snapshot();
    expect(second.devices).toBe(0);
    expect(await count('refresh_tokens')).toBe(0);
    expect(second.documents).toEqual(first.documents);
    expect({ ...second, users: undefined, tenants: undefined }).toEqual({ ...first, users: undefined, tenants: undefined });
  });

  it('is atomic: a failure in the middle of the seed leaves the previous demo exactly as it was', { timeout: 120_000 }, async () => {
    await reset();
    const before = await snapshot();
    let calls = 0;
    // The use cases read the clock once per document: this fails a few hundred documents into the history.
    const failing: Clock = {
      now: () => {
        if (++calls > 300) throw new Error('injected failure');
        return new Date();
      },
    };
    await expect(reset(ENV(), failing)).rejects.toThrow('injected failure');
    expect(calls).toBeGreaterThan(300);
    expect(await snapshot()).toEqual(before);
    expect(await unforcedTables()).toEqual([]);
  });
});
