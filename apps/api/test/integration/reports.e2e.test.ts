import { DailySeries, InventoryHealth, ReportSummary, SummaryByLocation, TopProducts } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpenApiDocument } from '../../src/common/openapi/openapi';
import { loginAs, resetAll, type SeededTenant, Seeder, Session } from './admin-fixtures';
import { createAuthApp, freshIp } from './auth-fixtures';
import { adminPool } from './helpers';
import { salesOutsideTheirDocuments } from './inventory-invariants';
import { insertProduct } from './inventory-fixtures';
import { SalesFixtures } from './sales-fixtures';

// SP4 · T6: the reports API (spec "API de reportes", "KPIs", "Zona horaria", "Alcance por punto").
let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let fx: SalesFixtures;
let a: SeededTenant;
let b: SeededTenant;
let rice: string;
let beans: string;
let cola: string;
let productOfB: string;
let cashier1: string;
let cashier2: string;

beforeAll(async () => {
  admin = adminPool();
  seeder = new Seeder(admin);
  fx = new SalesFixtures();
  app = await createAuthApp();
});
afterAll(async () => {
  await app.close();
  await resetAll(admin);
  await fx.end();
  await admin.end();
});
beforeEach(async () => {
  await resetAll(admin);
  a = await seeder.tenant('a');
  b = await seeder.tenant('b');
  rice = await insertProduct(admin, a.id, 'Arroz');
  beans = await insertProduct(admin, a.id, 'Frijol');
  cola = await insertProduct(admin, a.id, 'Refresco', 'USD');
  productOfB = await insertProduct(admin, b.id, 'Azúcar');
  await seeder.user(a.id, 'manager1@a.example', [[a.roles.manager, [L1()]]]);
  cashier1 = await seeder.user(a.id, 'cashier1@a.example', [[a.roles.cashier, [L1()]]]);
  cashier2 = await seeder.user(a.id, 'cashier2@a.example', [[a.roles.cashier, [L1()]]]);
});

const [L1, L2] = [() => a.locations[0], () => a.locations[1]];
const ENDPOINTS = ['summary', 'daily-series', 'top-products', 'by-location', 'inventory-health'] as const;
const RANGE = 'from=2026-01-10&to=2026-01-11';

const summary = async (session: Session, query: string) => ReportSummary.parse((await session.get(`/reports/summary?${query}`).expect(200)).body);
const series = async (session: Session, query: string) => DailySeries.parse((await session.get(`/reports/daily-series?${query}`).expect(200)).body);
const top = async (session: Session, query: string) => TopProducts.parse((await session.get(`/reports/top-products?${query}`).expect(200)).body);
const byLocation = async (session: Session, query: string) => SummaryByLocation.parse((await session.get(`/reports/by-location?${query}`).expect(200)).body);
const health = async (session: Session, query = '') => InventoryHealth.parse((await session.get(`/reports/inventory-health?${query}`).expect(200)).body);

const at = (local: string) => `${local} America/Havana`;
const sale = (location: string, cashier: string, local: string, lines: Parameters<SalesFixtures['sale']>[1]['lines']) =>
  fx.sale(a.id, { location, cashier, at: at(local), lines });

/**
 * The oracle fixture (spec "Tests": losses, a reversed entry, a cost sale, two currencies),
 * every total below computed by hand. Range 2026-01-10..11 at L1.
 */
async function oracle() {
  const owner = a.owner;
  // CUP, cash: 2 × 1000 = 2000, profit 2000 − 2 × 600 = 800.  Transfer: round(1.5 × 333 = 499.5) = 500, profit 500 − 150 = 350.
  await sale(L1(), owner, '2026-01-10 10:00', [
    { product: rice, quantity: 2, unitPrice: 1000, unitCost: 600 },
    { product: beans, quantity: 1.5, unitPrice: 333, unitCost: 100, paymentMethod: 'transfer' },
  ]);
  // A cost sale: 1000 cash, profit 0.
  await sale(L1(), cashier1, '2026-01-11 09:00', [{ product: rice, quantity: 1, unitPrice: 1000, unitCost: 600, isCostSale: true }]);
  // USD, transfer: 3 × 150 = 450, profit 450 − 301.5 = 148.5.
  await sale(L1(), cashier1, '2026-01-11 12:00', [{ product: cola, currency: 'USD', quantity: 3, unitPrice: 150, unitCost: 100.5, paymentMethod: 'transfer' }]);
  // Out of the range, in another location, and reversed (on another day): none counts at L1.
  await sale(L1(), owner, '2026-01-12 00:00:00', [{ product: rice, quantity: 7, unitPrice: 1000, unitCost: 600 }]);
  await sale(L2(), owner, '2026-01-10 11:00', [{ product: rice, quantity: 4, unitPrice: 900, unitCost: 600, paymentMethod: 'transfer' }]);
  const reversedSale = await sale(L1(), owner, '2026-01-10 18:00', [{ product: rice, quantity: 5, unitPrice: 1000, unitCost: 600 }]);
  await fx.reverse(a.id, reversedSale, at('2026-01-20 10:00'), owner);
  // Ledger: entry 10 × 600 = 6000; a reversed entry (4 × 250) does not count; shrinkage 0.5 × 600 = 300;
  // owner withdrawal 1 × 100 = 100; USD shrinkage 1 × 100.5 = 100.5. A shrinkage at L2 stays at L2.
  await fx.entry(a.id, { location: L1(), product: rice, quantity: 10, unitCost: 600, at: at('2026-01-10 08:00'), createdBy: owner });
  const reversedEntry = await fx.entry(a.id, { location: L1(), product: beans, quantity: 4, unitCost: 250, at: at('2026-01-10 08:30'), createdBy: owner });
  await fx.reverse(a.id, reversedEntry, at('2026-01-11 08:30'), owner);
  await fx.exit(a.id, { location: L1(), product: rice, quantity: 0.5, unitCost: 600, at: at('2026-01-10 20:00'), createdBy: owner, reason: 'shrinkage' });
  await fx.exit(a.id, { location: L1(), product: beans, quantity: 1, unitCost: 100, at: at('2026-01-11 20:00'), createdBy: owner, reason: 'owner_withdrawal' });
  await fx.exit(a.id, { location: L1(), product: cola, quantity: 1, unitCost: 100.5, at: at('2026-01-11 21:00'), createdBy: owner, reason: 'shrinkage' });
  await fx.exit(a.id, { location: L2(), product: rice, quantity: 2, unitCost: 600, at: at('2026-01-10 21:00'), createdBy: owner, reason: 'shrinkage' });
  // Tenant B sells too: never visible from A.
  await fx.sale(b.id, { location: b.locations[0], cashier: b.owner, at: at('2026-01-10 10:00'), lines: [{ product: productOfB, quantity: 1, unitPrice: 99_999, unitCost: 1 }] });
  expect(await salesOutsideTheirDocuments(admin)).toEqual([]);
}

const CUP_L1 = {
  currency: 'CUP',
  cashSales: 3000,
  transferSales: 500,
  totalSales: 3500,
  profit: 1150,
  margin: 0.3286,
  tickets: 2,
  averageTicket: 1750,
  shrinkageLoss: 300,
  ownerWithdrawals: 100,
  valuedEntries: 6000,
};
const USD_L1 = {
  currency: 'USD',
  cashSales: 0,
  transferSales: 450,
  totalSales: 450,
  profit: 148.5,
  margin: 0.33,
  tickets: 1,
  averageTicket: 450,
  shrinkageLoss: 100.5,
  ownerWithdrawals: 0,
  valuedEntries: 0,
};
// L2: 4 × 900 = 3600 by transfer, profit 3600 − 2400 = 1200; shrinkage 2 × 600 = 1200.
const CUP_L2 = {
  currency: 'CUP',
  cashSales: 0,
  transferSales: 3600,
  totalSales: 3600,
  profit: 1200,
  margin: 0.3333,
  tickets: 1,
  averageTicket: 3600,
  shrinkageLoss: 1200,
  ownerWithdrawals: 0,
  valuedEntries: 0,
};

describe('KPIs against a hand-computed oracle', () => {
  it('summarizes one location per currency: losses, reversed entry and sale, cost sale, two currencies', async () => {
    await oracle();
    const owner = await loginAs(app, 'owner@a.example');
    const report = await summary(owner, `${RANGE}&locationId=${L1()}`);
    expect(report).toEqual({
      scope: 'location',
      locationIds: [L1()],
      from: '2026-01-10',
      to: '2026-01-11',
      timeZone: 'America/Havana',
      asOf: expect.any(String),
      currencies: [CUP_L1, USD_L1],
    });
  });

  it('aggregates all my locations and splits them by location', async () => {
    await oracle();
    const owner = await loginAs(app, 'owner@a.example');
    const all = await summary(owner, RANGE);
    expect(all.locationIds).toEqual([L1(), L2()]);
    // 3000 + 0 cash, 500 + 3600 transfer, profit 1150 + 1200, tickets 3, average round(7100 / 3) = 2367.
    expect(all.currencies).toEqual([
      { ...CUP_L1, transferSales: 4100, totalSales: 7100, profit: 2350, margin: 0.331, tickets: 3, averageTicket: 2367, shrinkageLoss: 1500 },
      USD_L1,
    ]);
    const split = await byLocation(owner, RANGE);
    expect(split.locations).toEqual([
      { locationId: L1(), locationName: 'Location L1', currencies: [CUP_L1, USD_L1] },
      { locationId: L2(), locationName: 'Location L2', currencies: [CUP_L2] },
    ]);
  });

  it('ranks products by revenue, quantity or profit with a limit', async () => {
    await oracle();
    const owner = await loginAs(app, 'owner@a.example');
    const byRevenue = await top(owner, `${RANGE}&locationId=${L1()}`);
    expect(byRevenue.by).toBe('revenue');
    expect(byRevenue.items).toEqual([
      { productId: rice, name: 'Arroz', unitOfMeasure: 'kg', currency: 'CUP', quantity: 3, totalSales: 3000, profit: 800 },
      { productId: beans, name: 'Frijol', unitOfMeasure: 'kg', currency: 'CUP', quantity: 1.5, totalSales: 500, profit: 350 },
      { productId: cola, name: 'Refresco', unitOfMeasure: 'kg', currency: 'USD', quantity: 3, totalSales: 450, profit: 148.5 },
    ]);
    expect((await top(owner, `${RANGE}&locationId=${L1()}&by=profit`)).items.map((i) => i.productId)).toEqual([rice, beans, cola]);
    expect((await top(owner, `${RANGE}&locationId=${L1()}&by=quantity&limit=1`)).items.map((i) => i.productId)).toEqual([rice]);
  });

  it('cuts every report at now(): a later sale of the range does not count yet', async () => {
    const { rows } = await admin.query<{ today: string; tomorrow: string; past: string; future: string }>(
      `select (now() at time zone 'America/Havana')::date::text as today,
              ((now() at time zone 'America/Havana')::date + 1)::text as tomorrow,
              greatest(now() - interval '1 minute', (now() at time zone 'America/Havana')::date::timestamp at time zone 'America/Havana') as past,
              now() + interval '1 hour' as future`,
    );
    const { today, tomorrow, past, future } = rows[0]!;
    await fx.sale(a.id, { location: L1(), cashier: a.owner, at: new Date(past).toISOString(), lines: [{ product: rice, quantity: 1, unitPrice: 100, unitCost: 50 }] });
    await fx.sale(a.id, { location: L1(), cashier: a.owner, at: new Date(future).toISOString(), lines: [{ product: rice, quantity: 1, unitPrice: 9000, unitCost: 50 }] });
    const owner = await loginAs(app, 'owner@a.example');

    const range = await summary(owner, `from=${today}&to=${tomorrow}&locationId=${L1()}`);
    expect(range.currencies.map((c) => c.totalSales)).toEqual([100]);
    // Without from/to: today in the tenant zone, decided by the database.
    const todayReport = await summary(owner, `locationId=${L1()}`);
    expect({ from: todayReport.from, to: todayReport.to }).toEqual({ from: today, to: today });
    expect(todayReport.currencies.map((c) => c.totalSales)).toEqual([100]);
    expect(Date.parse(todayReport.asOf)).toBeLessThanOrEqual(Date.now() + 1000);
    const days = await series(owner, `from=${today}&to=${tomorrow}`);
    expect(days.series).toEqual([{ currency: 'CUP', points: [{ date: today, totalSales: 100, profit: 50 }, { date: tomorrow, totalSales: 0, profit: 0 }] }]);
  });
});

describe('local days in America/Havana', () => {
  it('keeps every sale in its local day across both DST changes, and the daily series adds up to the total', async () => {
    // Cuba moves the clock at midnight: 2026-03-08 has no 00:00 and 2026-11-01 has its first hour twice.
    const instants = [
      ['2026-03-07 23:59:59', 100],
      ['2026-03-08 00:00:01', 200],
      ['2026-03-08 23:59:59', 300],
      ['2026-10-31 23:59:59', 400],
      ['2026-11-01 00:00:01', 500],
      ['2026-11-01 00:30:00', 600],
      ['2026-11-01 23:59:59', 700],
      ['2026-11-02 00:00:01', 800],
    ] as const;
    for (const [local, price] of instants) {
      await sale(L1(), a.owner, local, [{ product: rice, quantity: 1, unitPrice: price, unitCost: 10 }]);
    }
    const owner = await loginAs(app, 'owner@a.example');
    const query = 'from=2026-03-01&to=2026-11-10';
    const days = await series(owner, query);
    const points = days.series[0]!.points;
    expect(points).toHaveLength(255);
    const day = (date: string) => points.find((p) => p.date === date)!.totalSales;
    expect([day('2026-03-07'), day('2026-03-08'), day('2026-10-31'), day('2026-11-01'), day('2026-11-02')]).toEqual([100, 500, 400, 1800, 800]);
    const total = (await summary(owner, query)).currencies[0]!.totalSales;
    expect(points.reduce((sum, p) => sum + p.totalSales, 0)).toBe(total);
    expect(total).toBe(3600);
    expect((await summary(owner, 'from=2026-03-08&to=2026-03-08')).currencies[0]!.totalSales).toBe(500);
    expect((await summary(owner, 'from=2026-11-01&to=2026-11-01')).currencies[0]!.totalSales).toBe(1800);
  });

  it('puts the first hour of a fall-back day (twice 00:00–01:00) in that day, in the series and the totals', async () => {
    // 2026-11-01 04:30 UTC is 00:30 CDT, the first of the two 00:30 of that day in Havana; 05:30 UTC is the second.
    for (const [instant, price] of [['2026-10-31 12:00+00', 10], ['2026-11-01 04:30+00', 20], ['2026-11-01 05:30+00', 40], ['2026-11-02 05:30+00', 80]] as const) {
      await fx.sale(a.id, { location: L1(), cashier: a.owner, at: instant, lines: [{ product: rice, quantity: 1, unitPrice: price, unitCost: 1 }] });
    }
    const owner = await loginAs(app, 'owner@a.example');
    const points = async (query: string) => (await series(owner, query)).series[0]!.points.map((p) => [p.date, p.totalSales, p.profit]);
    expect(await points('from=2026-10-31&to=2026-11-02')).toEqual([['2026-10-31', 10, 9], ['2026-11-01', 60, 58], ['2026-11-02', 80, 79]]);
    expect(await points('from=2026-11-01&to=2026-11-01')).toEqual([['2026-11-01', 60, 58]]);
    const day = async (date: string) => (await summary(owner, `from=${date}&to=${date}`)).currencies.map((c) => [c.totalSales, c.tickets]);
    expect(await day('2026-10-31')).toEqual([[10, 1]]);
    expect(await day('2026-11-01')).toEqual([[60, 2]]);
    expect(await day('2026-11-02')).toEqual([[80, 1]]);
  });

  it('echoes a stored zone Node no longer lists without re-validating it (ADR 0007 §4)', async () => {
    await admin.query(`update tenants set time_zone = 'Europe/Kyiv' where id = $1`, [a.id]);
    await fx.sale(a.id, { location: L1(), cashier: a.owner, at: '2026-01-10 23:30 Europe/Kyiv', lines: [{ product: rice, quantity: 1, unitPrice: 100, unitCost: 10 }] });
    const owner = await loginAs(app, 'owner@a.example');
    const report = await summary(owner, 'from=2026-01-10&to=2026-01-10');
    expect(report.timeZone).toBe('Europe/Kyiv');
    expect(report.currencies.map((c) => c.totalSales)).toEqual([100]);
    expect((await health(owner)).timeZone).toBe('Europe/Kyiv');
  });

  it('rejects an inverted or too long range (400)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    for (const query of ['from=2026-01-11&to=2026-01-10', 'from=2026-01-01&to=2027-01-02', 'from=2026-01-01', 'from=2026-02-30&to=2026-03-01']) {
      const res = await owner.get(`/reports/summary?${query}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('authorization and isolation', () => {
  it('answers 404 for a location of another tenant on every endpoint, and never shows its sales', async () => {
    await oracle();
    const owner = await loginAs(app, 'owner@a.example');
    for (const endpoint of ENDPOINTS) {
      const res = await owner.get(`/reports/${endpoint}?locationId=${b.locations[0]}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    const ownerOfB = await loginAs(app, 'owner@b.example');
    for (const endpoint of ENDPOINTS) await ownerOfB.get(`/reports/${endpoint}?locationId=${L1()}`).expect(404);
    const ofB = await summary(ownerOfB, RANGE);
    expect(ofB.locationIds).toEqual(b.locations);
    expect(ofB.currencies.map((c) => c.totalSales)).toEqual([99_999]);
    expect((await top(ownerOfB, RANGE)).items.map((i) => i.productId)).toEqual([productOfB]);
  });

  it('limits a Manager to the locations where it has reports:view, with the full location scope there', async () => {
    await oracle();
    const manager = await loginAs(app, 'manager1@a.example');
    for (const endpoint of ENDPOINTS) {
      const res = await manager.get(`/reports/${endpoint}?locationId=${L2()}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // Owner and Manager hold reports:view and reports:view_own: reports:view wins where it applies.
    const atL1 = await summary(manager, `${RANGE}&locationId=${L1()}`);
    expect(atL1).toMatchObject({ scope: 'location', locationIds: [L1()], currencies: [CUP_L1, USD_L1] });
    const mine = await summary(manager, RANGE);
    expect(mine).toMatchObject({ scope: 'location', locationIds: [L1()], currencies: [CUP_L1, USD_L1] });
    expect((await byLocation(manager, RANGE)).locations.map((l) => l.locationId)).toEqual([L1()]);
    expect((await series(manager, RANGE)).locationIds).toEqual([L1()]);
    expect((await top(manager, RANGE)).items.every((i) => i.totalSales !== 3600)).toBe(true);
    expect((await health(manager)).locationIds).toEqual([L1()]);
    expect((await health(manager)).lowStock.items.every((i) => i.locationId === L1())).toBe(true);
  });

  it('gives reports:view_own only its own sales of the location, never profit or costs, and only the summary', async () => {
    await oracle();
    await sale(L1(), cashier2, '2026-01-10 15:00', [{ product: beans, quantity: 1, unitPrice: 777, unitCost: 100 }]);
    const cashier = await loginAs(app, 'cashier1@a.example');
    const own = await summary(cashier, `${RANGE}&locationId=${L1()}`);
    // cashier1 made the cost sale (1000 cash) and the USD sale (450 transfer) only.
    expect(own).toEqual({
      scope: 'own',
      locationIds: [L1()],
      from: '2026-01-10',
      to: '2026-01-11',
      timeZone: 'America/Havana',
      asOf: expect.any(String),
      currencies: [
        { currency: 'CUP', cashSales: 1000, transferSales: 0, totalSales: 1000, profit: null, margin: null, tickets: 1, averageTicket: 1000, shrinkageLoss: null, ownerWithdrawals: null, valuedEntries: null },
        { currency: 'USD', cashSales: 0, transferSales: 450, totalSales: 450, profit: null, margin: null, tickets: 1, averageTicket: 450, shrinkageLoss: null, ownerWithdrawals: null, valuedEntries: null },
      ],
    });
    // locationId is required, the other location is not its own, and the other endpoints are reports:view only.
    await cashier.get(`/reports/summary?${RANGE}`).expect(403);
    await cashier.get(`/reports/summary?${RANGE}&locationId=${L2()}`).expect(403);
    for (const endpoint of ENDPOINTS.filter((e) => e !== 'summary')) {
      await cashier.get(`/reports/${endpoint}?locationId=${L1()}`).expect(403);
      await cashier.get(`/reports/${endpoint}`).expect(403);
    }
    // A cashier id in the query is ignored: the filter is the token's user.
    const spoofed = await summary(cashier, `${RANGE}&locationId=${L1()}&cashierUserId=${cashier2}`);
    expect(spoofed.currencies).toEqual(own.currencies);
  });

  it('answers 403 to "all my locations" when the visible locations are archived', async () => {
    const custom = await seeder.role(a.id, 'Analyst', ['reports:view']);
    await seeder.user(a.id, 'analyst@a.example', [[custom, [L2()]]]);
    await admin.query('update locations set archived_at = now() where id = $1', [L2()]);
    const analyst = await loginAs(app, 'analyst@a.example');
    await analyst.get('/reports/summary').expect(403);
    // An archived location leaves "all my locations", but its history still reports when asked by id.
    const owner = await loginAs(app, 'owner@a.example');
    expect((await summary(owner, '')).locationIds).toEqual([L1()]);
    expect((await summary(owner, `locationId=${L2()}`)).locationIds).toEqual([L2()]);
  });

  it('requires authentication, marks every answer private, no-store, and rate limits per IP', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const ok = await owner.get('/reports/summary').expect(200);
    expect(ok.headers['cache-control']).toBe('private, no-store');
    const denied = await (await loginAs(app, 'cashier1@a.example')).get('/reports/daily-series').expect(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');
    const anonymous = await new Session(app, 'x.y.z', 'device').get('/reports/summary').expect(401);
    expect(anonymous.headers['cache-control']).toBe('private, no-store');

    const sameIp = new Session(app, owner.token, owner.deviceId, freshIp());
    for (let i = 0; i < 30; i++) await sameIp.get('/reports/inventory-health').expect(200);
    const limited = await sameIp.get('/reports/inventory-health').expect(429);
    expect(limited.headers['cache-control']).toBe('private, no-store');
  });

  it('documents the five endpoints in OpenAPI', () => {
    const paths = Object.keys(createOpenApiDocument(app).paths);
    expect(paths).toEqual(expect.arrayContaining(ENDPOINTS.map((e) => `/reports/${e}`)));
  });
});

describe('GET /reports/inventory-health', () => {
  it('lists low stock, stagnant and near-expiration pairs with the domain rules, and values the stock', async () => {
    const { rows } = await admin.query<{ today: string; soon: string }>(
      `select (now() at time zone 'America/Havana')::date::text as today, ((now() at time zone 'America/Havana')::date + 3)::text as soon`,
    );
    const { soon } = rows[0]!;
    await admin.query(`update products set expiration_date = $1, low_stock_threshold = 2 where id = $2`, [soon, beans]);
    await admin.query(`update products set category = 'Bebidas' where id = $1`, [cola]);
    const archived = await insertProduct(admin, a.id, 'Viejo', 'CUP', true);
    await fx.entry(a.id, { location: L1(), product: rice, quantity: 10, unitCost: 600, at: at('2026-01-01 08:00'), createdBy: a.owner });
    await fx.entry(a.id, { location: L1(), product: beans, quantity: 3, unitCost: 100.123456, at: at('2026-01-01 08:00'), createdBy: a.owner });
    await fx.entry(a.id, { location: L1(), product: cola, quantity: 30, unitCost: 100, at: at('2026-01-01 08:00'), createdBy: a.owner });
    await fx.entry(a.id, { location: L1(), product: archived, quantity: 1, unitCost: 5, at: at('2026-01-01 08:00'), createdBy: a.owner });
    await fx.pair(a.id, L1(), rice, 600);
    await fx.pair(a.id, L1(), beans, 100.123456);
    await fx.pair(a.id, L1(), cola, 100);
    await fx.pair(a.id, L1(), archived, 5);
    // Rice sold long ago (stagnant); cola sold a minute ago (not stagnant).
    await sale(L1(), a.owner, '2026-01-02 10:00', [{ product: rice, quantity: 2, unitPrice: 1000, unitCost: 600 }]);
    await fx.sale(a.id, { location: L1(), cashier: a.owner, at: new Date(Date.now() - 60_000).toISOString(), lines: [{ product: cola, currency: 'USD', quantity: 10, unitPrice: 150, unitCost: 100 }] });
    const owner = await loginAs(app, 'owner@a.example');
    const report = await health(owner, `locationId=${L1()}`);
    const item = (productId: string, quantity: number, extra: object) => ({ productId, locationId: L1(), name: expect.any(String), unitOfMeasure: 'kg', quantity, ...extra });
    // Stock: rice 8, beans 3 (threshold 2: not low), cola 20 (Bebidas: 24, low), archived 1 (out of the lists).
    expect(report.lowStock).toEqual({ count: 1, items: [item(cola, 20, { threshold: 24 })] });
    expect(report.stagnant).toEqual({ count: 2, items: [item(beans, 3, { lastSaleDate: null }), item(rice, 8, { lastSaleDate: '2026-01-02' })] });
    expect(report.nearExpiration).toEqual({ count: 1, items: [item(beans, 3, { expirationDate: soon })] });
    // CUP: 8 × 600 + 3 × 100.123456 + 1 × 5 = 5105.370368; USD: 20 × 100 = 2000.
    expect(report.inventoryValue).toEqual([
      { currency: 'CUP', amount: 5105.370368 },
      { currency: 'USD', amount: 2000 },
    ]);
    // Low stock covers products never stocked in the location (stock 0), and L2 stays out of an L1 report.
    const atL2 = await health(owner, `locationId=${L2()}`);
    expect(atL2.lowStock.count).toBe(3);
    expect(atL2.inventoryValue).toEqual([]);
  });
});
