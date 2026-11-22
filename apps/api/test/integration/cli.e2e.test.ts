import { AuthTokens, MeResponse, PERMISSIONS } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { Argon2PasswordHasher } from '../../src/modules/iam/infrastructure/argon2-password-hasher';
import { DEMO_LOCATION_PRICES, DEMO_PRODUCTS } from '../../src/scripts/demo-history';
import { DEMO_USERS } from '../../src/scripts/demo-seed';
import { runSeed } from '../../src/scripts/seed';
import { runTenantCreate } from '../../src/scripts/tenant-create';
import { createAuthApp, freshIp, signedIpHeader } from './auth-fixtures';
import { negativeStockPairs, salesByLocalDay, salesTotal } from './demo-fixtures';
import { movementsOutsideDocumentLocations, salesOutsideTheirDocuments } from './inventory-invariants';
import { adminPool, resetTenants, urls } from './helpers';

let admin: Pool;
const hasher = new Argon2PasswordHasher();

beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
});

const count = async (table: string): Promise<number> => Number((await admin.query(`select count(*)::int as n from ${table}`)).rows[0].n);

function capture() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

const OWNER_URL = () => ({ DATABASE_MIGRATION_URL: urls().owner });
/** Tests that are not about the history seed one day of it, to keep the suite fast. */
const ONE_DAY = ['--history-days', '1'];
const ARGS = ['--name', 'Acme Store', '--slug', 'acme', '--owner-email', 'boss@acme.example'];

describe('tenant:create', () => {
  it('creates the tenant, the three system roles and an owner with a temporary password printed once', async () => {
    const out = capture();
    await runTenantCreate(ARGS, OWNER_URL(), out.write);

    const printed = out.lines.filter((line) => line.includes('Temporary password:'));
    expect(printed).toHaveLength(1);
    const password = printed[0]!.split('Temporary password:')[1]!.trim();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(out.lines.filter((line) => line.includes(password))).toHaveLength(1);

    expect((await admin.query('select name, slug from tenants')).rows).toEqual([{ name: 'Acme Store', slug: 'acme' }]);
    const roles = await admin.query('select key, is_system, (select count(*)::int from role_permissions p where p.role_id = r.id) as permissions from roles r order by key');
    expect(roles.rows).toEqual([
      { key: 'cashier', is_system: true, permissions: 5 },
      { key: 'manager', is_system: true, permissions: 11 },
      { key: 'owner', is_system: true, permissions: PERMISSIONS.length },
    ]);

    const user = (await admin.query('select * from users')).rows[0];
    expect(user.email).toBe('boss@acme.example');
    expect(user.must_change_password).toBe(true);
    expect(user.status).toBe('active');
    const ttl = new Date(user.password_expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(71 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(72 * 3600_000);
    expect(await hasher.verify(user.password_hash, password)).toBe(true);

    const assignment = (await admin.query(`select a.scope, r.key from role_assignments a join roles r on r.id = a.role_id`)).rows;
    expect(assignment).toEqual([{ scope: 'tenant', key: 'owner' }]);
  });

  it('rolls everything back on a duplicate slug or owner email', async () => {
    await runTenantCreate(ARGS, OWNER_URL(), capture().write);
    await expect(runTenantCreate([...ARGS.slice(0, 5), 'other@acme.example'], OWNER_URL(), capture().write)).rejects.toThrow(/slug/i);
    await expect(runTenantCreate(['--name', 'B', '--slug', 'b', '--owner-email', 'boss@acme.example'], OWNER_URL(), capture().write)).rejects.toThrow(/email/i);
    expect(await count('tenants')).toBe(1);
    expect(await count('users')).toBe(1);
    expect(await count('roles')).toBe(3);
  });

  it.each([
    [['--slug', 'acme', '--owner-email', 'a@b.example'], /--name/],
    [['--name', 'A', '--owner-email', 'a@b.example'], /--slug/],
    [['--name', 'A', '--slug', 'acme'], /--owner-email/],
    [['--name', 'A', '--slug', 'Not A Slug', '--owner-email', 'a@b.example'], /slug/i],
    [['--name', 'A', '--slug', 'acme', '--owner-email', 'nope'], /email/i],
  ])('rejects invalid arguments %j without touching the database', async (args, message) => {
    const out = capture();
    await expect(runTenantCreate(args, OWNER_URL(), out.write)).rejects.toThrow(message);
    expect(out.lines).toEqual([]);
    expect(await count('tenants')).toBe(0);
  });

  it('stores the time zone given with --time-zone, and America/Havana without it (SP4 · D3)', async () => {
    const out = capture();
    await runTenantCreate([...ARGS, '--time-zone', 'Europe/Madrid'], OWNER_URL(), out.write);
    await runTenantCreate(['--name', 'B', '--slug', 'b', '--owner-email', 'b@b.example'], OWNER_URL(), capture().write);
    expect((await admin.query('select slug, time_zone, read_only from tenants order by slug')).rows).toEqual([
      { slug: 'acme', time_zone: 'Europe/Madrid', read_only: false },
      { slug: 'b', time_zone: 'America/Havana', read_only: false },
    ]);
    expect(out.lines).toContain('Time zone: Europe/Madrid');
  });

  it.each(['Mars/Olympus', '+05:00', 'havana', ''])('rejects the time zone %j without touching the database', async (zone) => {
    const out = capture();
    await expect(runTenantCreate([...ARGS, '--time-zone', zone], OWNER_URL(), out.write)).rejects.toThrow(/time zone/i);
    expect(out.lines).toEqual([]);
    expect(await count('tenants')).toBe(0);
  });

  it('requires the owner connection URL', async () => {
    await expect(runTenantCreate(ARGS, {}, capture().write)).rejects.toThrow(/DATABASE_MIGRATION_URL/);
  });
});

describe('db:seed', () => {
  it('is idempotent and creates the demo tenant with 2 locations and 3 users', async () => {
    await runSeed(OWNER_URL(), capture().write, ONE_DAY);
    await runSeed(OWNER_URL(), capture().write, ONE_DAY);

    expect(await count('tenants')).toBe(1);
    expect(await count('locations')).toBe(2);
    expect(await count('users')).toBe(3);
    expect(await count('roles')).toBe(3);
    expect(await count('role_assignments')).toBe(3);
    expect(await count('role_assignment_locations')).toBe(2);

    const scoped = await admin.query(
      `select u.email, r.key, a.scope, l.code
         from role_assignments a join users u on u.id = a.user_id join roles r on r.id = a.role_id
         left join role_assignment_locations al on al.assignment_id = a.id left join locations l on l.id = al.location_id
        order by u.email`,
    );
    expect(scoped.rows).toEqual([
      { email: DEMO_USERS.cashier.email, key: 'cashier', scope: 'locations', code: 'P1' },
      { email: DEMO_USERS.manager.email, key: 'manager', scope: 'locations', code: 'P1' },
      { email: DEMO_USERS.owner.email, key: 'owner', scope: 'tenant', code: null },
    ]);
  });

  it('seeds the catalog, P2 prices and the default 14 days of history once, through the use cases (a re-run changes nothing)', async () => {
    await runSeed(OWNER_URL(), capture().write);
    const snapshot = async () => ({
      products: await count('products'),
      documents: (await admin.query('select kind, count(*)::int as n from inventory_documents group by kind order by kind')).rows,
      movements: await count('inventory_movements'),
      sales: await count('sales'),
      saleLines: await count('sale_lines'),
      locationProducts: (await admin.query('select * from location_products order by location_id, product_id')).rows,
      audit: (await admin.query('select type, count(*)::int as n from audit_events group by type order by type')).rows,
    });
    const first = await snapshot();
    const out = capture();
    await runSeed(OWNER_URL(), out.write);
    expect(await snapshot()).toEqual(first);
    expect(out.lines.at(-1)).toMatch(/already has sales/);

    expect(first.products).toBe(DEMO_PRODUCTS.length);
    const documents = Object.fromEntries(first.documents.map((row: { kind: string; n: number }) => [row.kind, row.n]));
    expect(documents.entry).toBeGreaterThanOrEqual(4);
    expect(documents.exit).toBeGreaterThanOrEqual(1);
    expect(documents.transfer).toBeGreaterThanOrEqual(1);
    expect(first.sales).toBe(documents.sale);
    expect(first.sales).toBeGreaterThan(14 * 2 * 25 * 0.9);
    // One audit event per write: the use cases ran (and the re-run wrote nothing).
    const exits = (await admin.query(`select reason, count(*)::int as n from inventory_documents where kind = 'exit' group by reason`)).rows;
    expect(first.audit).toEqual(
      expect.arrayContaining([
        { type: 'product_created', n: DEMO_PRODUCTS.length },
        { type: 'location_price_set', n: DEMO_LOCATION_PRICES.length },
        { type: 'inventory_entry_recorded', n: documents.entry },
        { type: 'inventory_exit_recorded', n: exits.reduce((n: number, row: { n: number }) => n + row.n, 0) },
        { type: 'inventory_transfer_recorded', n: documents.transfer },
        { type: 'sale_recorded', n: first.sales },
      ]),
    );
    expect(await movementsOutsideDocumentLocations(admin)).toEqual([]);
    expect(await salesOutsideTheirDocuments(admin)).toEqual([]);

    const pair = async (code: string, name: string) =>
      (
        await admin.query(
          `select lp.cash_price_override as cash, lp.transfer_price_override as transfer
             from location_products lp join locations l on l.id = lp.location_id join products p on p.id = lp.product_id
            where l.code = $1 and p.name = $2`,
          [code, name],
        )
      ).rows[0];
    expect(await pair('P2', 'Arroz')).toMatchObject({ cash: '26000', transfer: '27000' });
    expect(await pair('P1', 'Arroz')).toMatchObject({ cash: null, transfer: null });
  });

  it('never leaves a pair with negative stock, not even in the middle of the history', async () => {
    await runSeed(OWNER_URL(), capture().write);
    expect(await negativeStockPairs(admin)).toEqual([]);
    // The running balance of every pair, in ledger order, never dips under zero either.
    const { rows } = await admin.query(
      `select count(*)::int as n from (
         select sum(m.quantity_delta) over (partition by m.location_id, m.product_id order by d.occurred_at, d.id rows unbounded preceding) as running
           from inventory_movements m join inventory_documents d on d.id = m.document_id) t
        where running < 0`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('dates the history in the tenant zone: sales today and on each of the last 14 local days, and KPIs for today and 30 days', async () => {
    await runSeed(OWNER_URL(), capture().write);
    expect((await admin.query('select time_zone, read_only from tenants')).rows).toEqual([{ time_zone: 'America/Havana', read_only: false }]);
    const days = await salesByLocalDay(admin, 30);
    expect(days).toHaveLength(14);
    expect(days.at(-1)!.day).toBe((await admin.query(`select (now() at time zone 'America/Havana')::date::text as d`)).rows[0].d);
    for (const day of days) expect(day.locations).toBe(2);
    // The KPIs cut at now() (D14): 30 days are never empty; today's sales are all there, whatever the hour.
    expect(await salesTotal(admin, 30)).toBeGreaterThan(0);
  });

  it('seeds as many days as --history-days asks for, and rejects an invalid value before touching the database', async () => {
    await runSeed(OWNER_URL(), capture().write, ['--history-days', '3']);
    expect(await salesByLocalDay(admin, 30)).toHaveLength(3);
    await resetTenants(admin);
    for (const bad of [['--history-days', '0'], ['--history-days', 'x'], ['--nope']]) {
      await expect(runSeed(OWNER_URL(), capture().write, bad)).rejects.toThrow();
    }
    expect(await count('tenants')).toBe(0);
  });

  it('seeds the Cashier with the SP3 read permissions and SP4 reports:view_own instead of reports:view', async () => {
    await runSeed(OWNER_URL(), capture().write, ONE_DAY);
    const { rows } = await admin.query<{ permission: string }>(
      `select rp.permission from role_assignments a join users u on u.id = a.user_id
         join role_permissions rp on rp.role_id = a.role_id where u.email = $1`,
      [DEMO_USERS.cashier.email],
    );
    expect(rows.map((r) => r.permission).sort()).toEqual(
      ['cash:close', 'catalog:view', 'inventory:view', 'reports:view_own', 'sales:create'],
    );
  });

  it('does not reset a password changed after the first seed', async () => {
    await runSeed(OWNER_URL(), capture().write, ONE_DAY);
    await admin.query(`update users set password_hash = 'changed' where email = $1`, [DEMO_USERS.owner.email]);
    await runSeed(OWNER_URL(), capture().write, ONE_DAY);
    expect((await admin.query(`select password_hash from users where email = $1`, [DEMO_USERS.owner.email])).rows[0].password_hash).toBe('changed');
  });

  it.each(['production', 'Production', 'staging', ''])('refuses to run with NODE_ENV=%j', async (nodeEnv) => {
    await expect(runSeed({ ...OWNER_URL(), NODE_ENV: nodeEnv }, capture().write)).rejects.toThrow(/NODE_ENV/);
    expect(await count('tenants')).toBe(0);
  });

  it.each([undefined, 'development', 'test'])('runs with NODE_ENV=%s', async (nodeEnv) => {
    await runSeed({ ...OWNER_URL(), NODE_ENV: nodeEnv }, capture().write, ONE_DAY);
    expect(await count('tenants')).toBe(1);
  });

  it('fails clearly when a demo email already belongs to another tenant', async () => {
    await runTenantCreate(['--name', 'Mine', '--slug', 'mine', '--owner-email', DEMO_USERS.manager.email], OWNER_URL(), capture().write);
    await expect(runSeed(OWNER_URL(), capture().write, ONE_DAY)).rejects.toThrow(new RegExp(`${DEMO_USERS.manager.email}.*another tenant`));
    expect(await count('tenants')).toBe(1);
  });

  it('fails clearly when the demo slug belongs to another tenant', async () => {
    await runTenantCreate(['--name', 'Mine', '--slug', 'demo', '--owner-email', 'x@y.example'], OWNER_URL(), capture().write);
    await expect(runSeed(OWNER_URL(), capture().write, ONE_DAY)).rejects.toThrow(/demo/);
    expect(await count('tenants')).toBe(1);
  });

  describe('demo logins', () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await createAuthApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(Object.keys(DEMO_USERS) as (keyof typeof DEMO_USERS)[])('%s can log in with the documented password', async (role) => {
      await runSeed(OWNER_URL(), capture().write, ONE_DAY);
      const ip = freshIp();
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', ip))
        .send({ email: DEMO_USERS[role].email, password: DEMO_USERS[role].password, device: { label: 'seed check', platform: 'web' } })
        .expect(200);
      expect(AuthTokens.parse(res.body).accessToken).toBeTruthy();
    });

    it('GET /me: the seed Cashier has reports:view_own at its location and not reports:view (SP4 · D4)', async () => {
      await runSeed(OWNER_URL(), capture().write, ONE_DAY);
      const ip = freshIp();
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', ip))
        .send({ email: DEMO_USERS.cashier.email, password: DEMO_USERS.cashier.password, device: { label: 'seed check', platform: 'web' } })
        .expect(200);
      const me = MeResponse.parse(
        (await request(app.getHttpServer()).get('/me').set('authorization', `Bearer ${AuthTokens.parse(login.body).accessToken}`).expect(200)).body,
      );
      const held = me.permissions.map((g) => g.permission);
      expect(held).toContain('reports:view_own');
      expect(held).not.toContain('reports:view');
      const p1 = (await admin.query<{ id: string }>(`select id from locations where code = 'P1'`)).rows[0]!.id;
      expect(me.permissions.find((g) => g.permission === 'reports:view_own')?.scope).toEqual({ type: 'locations', locationIds: [p1] });
    });
  });
});
