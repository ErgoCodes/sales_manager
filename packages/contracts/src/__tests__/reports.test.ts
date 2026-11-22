import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DailySeries,
  DEMO_ERROR_CODES,
  InventoryHealth,
  LocalDate,
  MAX_REPORT_RANGE_DAYS,
  MoneyByCurrency,
  ReportRangeQuery,
  ReportSummary,
  SummaryByLocation,
  TimeZone,
  TopProducts,
  TopProductsQuery,
  uuidv7,
} from '../index';

const LOCATION = uuidv7();
const PRODUCT = uuidv7();

describe('LocalDate', () => {
  it('accepts a calendar day YYYY-MM-DD', () => {
    expect(LocalDate.safeParse('2026-11-21').success).toBe(true);
    expect(LocalDate.safeParse('2024-02-29').success).toBe(true);
  });
  it('rejects instants, other formats and impossible days', () => {
    for (const bad of ['2026-11-21T00:00:00Z', '21/11/2026', '2026-1-5', '2026-02-30', '2025-02-29', '2026-13-01', '', 20261121]) {
      expect(LocalDate.safeParse(bad).success).toBe(false);
    }
  });
});

describe('TimeZone', () => {
  it('accepts IANA zones from Intl.supportedValuesOf', () => {
    expect(TimeZone.safeParse('America/Havana').success).toBe(true);
    expect(TimeZone.safeParse('Europe/Madrid').success).toBe(true);
  });
  it('rejects unknown zones, offsets and garbage', () => {
    for (const bad of ['America/Atlantis', '+05:00', 'GMT+5', 'havana', '', 3]) expect(TimeZone.safeParse(bad).success).toBe(false);
  });
});

describe('ReportRangeQuery', () => {
  it('accepts no dates (today in the tenant time zone) and an optional location', () => {
    expect(ReportRangeQuery.parse({})).toEqual({});
    expect(ReportRangeQuery.parse({ locationId: LOCATION })).toEqual({ locationId: LOCATION });
  });

  it('accepts a single day and from < to', () => {
    expect(ReportRangeQuery.safeParse({ from: '2026-11-21', to: '2026-11-21' }).success).toBe(true);
    expect(ReportRangeQuery.safeParse({ from: '2026-11-01', to: '2026-11-21' }).success).toBe(true);
  });

  it('rejects from > to on the "to" path', () => {
    const result = ReportRangeQuery.safeParse({ from: '2026-11-22', to: '2026-11-21' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([['to']]);
  });

  it('allows at most 366 days, both ends inclusive (a whole leap year)', () => {
    expect(MAX_REPORT_RANGE_DAYS).toBe(366);
    expect(ReportRangeQuery.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(true);
    expect(ReportRangeQuery.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(true);
    expect(ReportRangeQuery.safeParse({ from: '2024-01-01', to: '2025-01-01' }).success).toBe(false);
    expect(ReportRangeQuery.safeParse({ from: '2020-01-01', to: '2026-11-21' }).success).toBe(false);
  });

  it('needs both ends or neither, so the range limit is always checked here', () => {
    expect(ReportRangeQuery.safeParse({ from: '2026-11-01' }).success).toBe(false);
    expect(ReportRangeQuery.safeParse({ to: '2026-11-01' }).success).toBe(false);
  });

  it('rejects invalid days and a non-UUIDv7 location', () => {
    expect(ReportRangeQuery.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(ReportRangeQuery.safeParse({ locationId: 'p1' }).success).toBe(false);
  });
});

describe('TopProductsQuery', () => {
  it('defaults to revenue and 10, parsing the limit from the query string', () => {
    expect(TopProductsQuery.parse({})).toEqual({ by: 'revenue', limit: 10 });
    expect(TopProductsQuery.parse({ by: 'profit', limit: '50' })).toMatchObject({ by: 'profit', limit: 50 });
  });
  it('rejects a limit outside 1..50 and an unknown order', () => {
    for (const limit of ['0', '51', '-1', 'x']) expect(TopProductsQuery.safeParse({ limit }).success).toBe(false);
    expect(TopProductsQuery.safeParse({ by: 'name' }).success).toBe(false);
  });
  it('keeps the range rules of ReportRangeQuery', () => {
    expect(TopProductsQuery.safeParse({ from: '2026-11-22', to: '2026-11-21' }).success).toBe(false);
    expect(TopProductsQuery.safeParse({ from: '2024-01-01', to: '2025-01-01' }).success).toBe(false);
  });
});

const range = { from: '2026-11-21', to: '2026-11-21', timeZone: 'America/Havana', asOf: '2026-11-21T15:00:00Z' };
const totals = {
  currency: 'CUP',
  cashSales: 1500,
  transferSales: 500,
  totalSales: 2000,
  profit: 412.5,
  margin: 0.2063,
  tickets: 3,
  averageTicket: 667,
  shrinkageLoss: 120.25,
  ownerWithdrawals: 0,
  valuedEntries: 9000,
};
const ownTotals = { ...totals, profit: null, margin: null, shrinkageLoss: null, ownerWithdrawals: null, valuedEntries: null };

describe('ReportSummary', () => {
  it('location scope: totals per currency with costs', () => {
    expect(ReportSummary.safeParse({ scope: 'location', locationIds: [LOCATION], ...range, currencies: [totals] }).success).toBe(true);
  });
  it("own scope: profit, margin and losses come back null (D4)", () => {
    expect(ReportSummary.safeParse({ scope: 'own', locationIds: [LOCATION], ...range, currencies: [ownTotals] }).success).toBe(true);
  });
  it('an empty period is an empty list of currencies; null margin and average ticket without sales', () => {
    expect(ReportSummary.safeParse({ scope: 'location', locationIds: [], ...range, currencies: [] }).success).toBe(true);
    expect(
      ReportSummary.safeParse({ scope: 'location', locationIds: [LOCATION], ...range, currencies: [{ ...totals, margin: null, averageTicket: null }] })
        .success,
    ).toBe(true);
  });
  it('rejects an unknown scope, a negative sale, a fractional ticket count and an invalid time zone', () => {
    const ok = { scope: 'location', locationIds: [LOCATION], ...range, currencies: [totals] };
    expect(ReportSummary.safeParse({ ...ok, scope: 'tenant' }).success).toBe(false);
    expect(ReportSummary.safeParse({ ...ok, currencies: [{ ...totals, cashSales: -1 }] }).success).toBe(false);
    expect(ReportSummary.safeParse({ ...ok, currencies: [{ ...totals, tickets: 1.5 }] }).success).toBe(false);
    expect(ReportSummary.safeParse({ ...ok, timeZone: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('report responses', () => {
  it('DailySeries: one point per local day per currency', () => {
    const series = [{ currency: 'CUP', points: [{ date: '2026-11-21', totalSales: 2000, profit: 412.5 }, { date: '2026-11-22', totalSales: 0, profit: 0 }] }];
    expect(DailySeries.safeParse({ locationIds: [LOCATION], ...range, series }).success).toBe(true);
    expect(DailySeries.safeParse({ locationIds: [LOCATION], ...range, series: [{ currency: 'CUP', points: [{ date: 'x', totalSales: 0, profit: 0 }] }] }).success).toBe(false);
  });

  it('TopProducts: product, quantity, sales and profit with its currency', () => {
    const items = [{ productId: PRODUCT, name: 'Arroz', unitOfMeasure: 'kg', currency: 'CUP', quantity: 2.5, totalSales: 5000, profit: 800 }];
    expect(TopProducts.safeParse({ locationIds: [LOCATION], ...range, by: 'revenue', items }).success).toBe(true);
    expect(TopProducts.safeParse({ locationIds: [LOCATION], ...range, by: 'revenue', items: [{ ...items[0], currency: 'EUR' }] }).success).toBe(false);
  });

  it('SummaryByLocation: a compact summary per visible location', () => {
    const locations = [{ locationId: LOCATION, locationName: 'Punto 1', currencies: [totals] }];
    expect(SummaryByLocation.safeParse({ ...range, locations }).success).toBe(true);
  });

  it('InventoryHealth: counts, first items of each list and inventory value per currency', () => {
    const item = { productId: PRODUCT, locationId: LOCATION, name: 'Arroz', unitOfMeasure: 'kg', quantity: 1 };
    const health = {
      locationIds: [LOCATION],
      timeZone: 'America/Havana',
      asOf: '2026-11-21T15:00:00Z',
      lowStock: { count: 1, items: [{ ...item, threshold: 5 }] },
      stagnant: { count: 1, items: [{ ...item, lastSaleDate: null }] },
      nearExpiration: { count: 1, items: [{ ...item, expirationDate: '2026-11-30' }] },
      inventoryValue: [{ currency: 'CUP', amount: 123456.5 }],
    };
    expect(InventoryHealth.safeParse(health).success).toBe(true);
    expect(InventoryHealth.safeParse({ ...health, lowStock: { count: 11, items: Array(11).fill({ ...item, threshold: 5 }) } }).success).toBe(false);
    expect(InventoryHealth.safeParse({ ...health, nearExpiration: { count: 1, items: [{ ...item, expirationDate: null }] } }).success).toBe(false);
  });

  it('MoneyByCurrency allows a sub-cent fraction, never negative', () => {
    expect(MoneyByCurrency.safeParse([{ currency: 'USD', amount: 0.5 }]).success).toBe(true);
    expect(MoneyByCurrency.safeParse([{ currency: 'USD', amount: -1 }]).success).toBe(false);
  });

  it('every report schema has its own OpenAPI id', () => {
    const ids = { LocalDate, TimeZone, ReportRangeQuery, TopProductsQuery, MoneyByCurrency, ReportSummary, DailySeries, TopProducts, SummaryByLocation, InventoryHealth };
    for (const [name, schema] of Object.entries(ids)) expect(z.globalRegistry.get(schema)?.id).toBe(name);
  });
});

describe('SP4 error codes', () => {
  it('adds the DEMO_READ_ONLY error code', () => {
    expect([...DEMO_ERROR_CODES]).toEqual(['DEMO_READ_ONLY']);
  });
});
