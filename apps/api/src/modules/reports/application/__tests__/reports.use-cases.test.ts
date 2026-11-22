import { MAX_HEALTH_ITEMS } from '@monaco/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ACTOR_ID,
  actorWith,
  at,
  CASHIER_ROLE,
  custom,
  LOC_1,
  LOC_2,
  MANAGER_ROLE,
  owner,
  TENANT,
} from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import type { PairHealthRecord, ReportsReader, ReportsUnitOfWork } from '../../domain/reports-ports';
import { GetDailySeries, GetInventoryHealth, GetReportSummary, GetSummaryByLocation, GetTopProducts } from '../reports.use-cases';

const PRODUCT = '0190a000-0000-7000-8000-0000000000d1';
const AS_OF = new Date('2026-11-21T15:00:00.000Z');
const CLOCK = { timeZone: 'America/Havana', asOf: AS_OF, today: '2026-11-21' };
const LOCATIONS = [
  { id: LOC_1, name: 'Centro' },
  { id: LOC_2, name: 'Playa' },
];

function fakeReader(overrides: Partial<Record<keyof ReportsReader, ReturnType<typeof vi.fn>>> = {}) {
  const reader = {
    clock: vi.fn(async () => CLOCK),
    findLocation: vi.fn(async (id: string) => LOCATIONS.find((l) => l.id === id) ?? null),
    activeLocations: vi.fn(async () => LOCATIONS),
    salesTotals: vi.fn(async () => []),
    valuedMovements: vi.fn(async () => []),
    dailySales: vi.fn(async () => []),
    topProducts: vi.fn(async () => []),
    pairHealth: vi.fn(async () => []),
    ...overrides,
  };
  const runs: string[] = [];
  const uow: ReportsUnitOfWork = {
    run: async (tenantId, work) => {
      runs.push(tenantId);
      return work(reader as unknown as ReportsReader);
    },
  };
  return { reader, uow, runs };
}

const cashierAt = (...locations: string[]) => actorWith([{ role: CASHIER_ROLE, scope: at(...locations) }]);
const managerAt = (...locations: string[]) => actorWith([{ role: MANAGER_ROLE, scope: at(...locations) }]);

describe('GetReportSummary', () => {
  it('reads today in the tenant zone by default and echoes the range, zone and cut-off', async () => {
    const { reader, uow, runs } = fakeReader({
      salesTotals: vi.fn(async () => [{ locationId: null, currency: 'CUP', cashSales: 300, transferSales: 200, profit: 125.5, tickets: 2 }]),
      valuedMovements: vi.fn(async () => [{ locationId: LOC_1, kind: 'shrinkage', currency: 'CUP', unitCost: 10.5, quantity: 2 }]),
    });
    const report = await new GetReportSummary(uow).execute(owner(), { locationId: LOC_1 });
    expect(runs).toEqual([TENANT]);
    expect(report).toEqual({
      scope: 'location',
      locationIds: [LOC_1],
      from: '2026-11-21',
      to: '2026-11-21',
      timeZone: 'America/Havana',
      asOf: AS_OF.toISOString(),
      currencies: [
        {
          currency: 'CUP',
          cashSales: 300,
          transferSales: 200,
          totalSales: 500,
          profit: 125.5,
          margin: 0.251,
          tickets: 2,
          averageTicket: 250,
          shrinkageLoss: 21,
          ownerWithdrawals: 0,
          valuedEntries: 0,
        },
      ],
    });
    const filter = { locationIds: [LOC_1], range: { from: '2026-11-21', to: '2026-11-21' }, timeZone: 'America/Havana' };
    expect(reader.salesTotals).toHaveBeenCalledWith(filter, false);
    expect(reader.valuedMovements).toHaveBeenCalledWith(filter);
  });

  it('passes an explicit range and aggregates every active location with reports:view', async () => {
    const { reader, uow } = fakeReader();
    const analyst = actorWith([{ role: custom('analyst', 'reports:view'), scope: at(LOC_2) }]);
    const report = await new GetReportSummary(uow).execute(analyst, { from: '2026-01-01', to: '2026-01-31' });
    expect(report).toMatchObject({ scope: 'location', locationIds: [LOC_2], from: '2026-01-01', to: '2026-01-31', currencies: [] });
    expect(reader.salesTotals).toHaveBeenCalledWith(expect.objectContaining({ locationIds: [LOC_2], range: { from: '2026-01-01', to: '2026-01-31' } }), false);
  });

  it("gives reports:view_own the actor's own sales, without costs and without reading the ledger", async () => {
    const { reader, uow } = fakeReader({
      salesTotals: vi.fn(async () => [{ locationId: null, currency: 'USD', cashSales: 0, transferSales: 450, profit: 99, tickets: 1 }]),
    });
    const report = await new GetReportSummary(uow).execute(cashierAt(LOC_1), { locationId: LOC_1 });
    expect(report.scope).toBe('own');
    expect(report.currencies).toEqual([
      {
        currency: 'USD',
        cashSales: 0,
        transferSales: 450,
        totalSales: 450,
        profit: null,
        margin: null,
        tickets: 1,
        averageTicket: 450,
        shrinkageLoss: null,
        ownerWithdrawals: null,
        valuedEntries: null,
      },
    ]);
    expect(reader.salesTotals).toHaveBeenCalledWith(expect.objectContaining({ cashierUserId: ACTOR_ID }), false);
    expect(reader.valuedMovements).not.toHaveBeenCalled();
  });

  it('uses the location scope for a Manager, who holds reports:view and reports:view_own', async () => {
    const { reader, uow } = fakeReader();
    expect((await new GetReportSummary(uow).execute(managerAt(LOC_1), { locationId: LOC_1 })).scope).toBe('location');
    expect(reader.salesTotals).toHaveBeenCalledWith(expect.not.objectContaining({ cashierUserId: expect.anything() }), false);
  });

  it('denies before reading: no permission at the location, view_own without a location, nothing visible', async () => {
    const { reader, uow, runs } = fakeReader();
    const useCase = new GetReportSummary(uow);
    await expect(useCase.execute(cashierAt(LOC_1), { locationId: LOC_2 })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(useCase.execute(cashierAt(LOC_1), {})).rejects.toBeInstanceOf(PermissionDenied);
    expect(runs).toEqual([]);
    // reports:view only in a location that is no longer active.
    reader.activeLocations.mockResolvedValueOnce([{ id: LOC_1, name: 'Centro' }]);
    await expect(useCase.execute(managerAt(LOC_2), {})).rejects.toBeInstanceOf(PermissionDenied);
    expect(reader.salesTotals).not.toHaveBeenCalled();
  });

  it('answers 404 for a location the tenant does not have, after the permission check', async () => {
    const { reader, uow } = fakeReader({ findLocation: vi.fn(async () => null) });
    await expect(new GetReportSummary(uow).execute(owner(), { locationId: LOC_1 })).rejects.toBeInstanceOf(ResourceNotFound);
    expect(reader.salesTotals).not.toHaveBeenCalled();
  });
});

describe('ranged reports with reports:view only', () => {
  const cases = [
    ['daily-series', (uow: ReportsUnitOfWork) => new GetDailySeries(uow), {}],
    ['top-products', (uow: ReportsUnitOfWork) => new GetTopProducts(uow), { by: 'revenue', limit: 10 }],
    ['by-location', (uow: ReportsUnitOfWork) => new GetSummaryByLocation(uow), {}],
    ['inventory-health', (uow: ReportsUnitOfWork) => new GetInventoryHealth(uow), {}],
  ] as const;

  it.each(cases)('%s denies reports:view_own, at the location and overall', async (_name, build, extra) => {
    const { uow, runs } = fakeReader();
    const useCase = build(uow) as { execute: (actor: unknown, query: unknown) => Promise<unknown> };
    await expect(useCase.execute(cashierAt(LOC_1), { ...extra, locationId: LOC_1 })).rejects.toBeInstanceOf(PermissionDenied);
    await expect(useCase.execute(cashierAt(LOC_1), extra)).rejects.toBeInstanceOf(PermissionDenied);
    expect(runs).toEqual([]);
  });

  it('daily-series groups the points by currency, in catalog order', async () => {
    const point = (currency: string, date: string, totalSales: number) => ({ currency, date, totalSales, profit: totalSales / 2 });
    const { uow } = fakeReader({
      dailySales: vi.fn(async () => [point('USD', '2026-01-01', 10), point('CUP', '2026-01-01', 0), point('CUP', '2026-01-02', 40)]),
    });
    const report = await new GetDailySeries(uow).execute(owner(), { from: '2026-01-01', to: '2026-01-02' });
    expect(report.locationIds).toEqual([LOC_1, LOC_2]);
    expect(report.series).toEqual([
      { currency: 'CUP', points: [{ date: '2026-01-01', totalSales: 0, profit: 0 }, { date: '2026-01-02', totalSales: 40, profit: 20 }] },
      { currency: 'USD', points: [{ date: '2026-01-01', totalSales: 10, profit: 5 }] },
    ]);
  });

  it('top-products passes the order and the limit to the reader', async () => {
    const item = { productId: PRODUCT, name: 'Arroz', unitOfMeasure: 'kg', currency: 'CUP', quantity: 2, totalSales: 10, profit: 3 };
    const { reader, uow } = fakeReader({ topProducts: vi.fn(async () => [item]) });
    const report = await new GetTopProducts(uow).execute(owner(), { locationId: LOC_2, by: 'profit', limit: 3 });
    expect(report).toMatchObject({ locationIds: [LOC_2], by: 'profit', items: [item] });
    expect(reader.topProducts).toHaveBeenCalledWith(expect.objectContaining({ locationIds: [LOC_2] }), 'profit', 3);
  });

  it('by-location gives each visible location its own totals, with costs', async () => {
    const { reader, uow } = fakeReader({
      salesTotals: vi.fn(async () => [{ locationId: LOC_2, currency: 'CUP', cashSales: 100, transferSales: 0, profit: 40, tickets: 1 }]),
      valuedMovements: vi.fn(async () => [{ locationId: LOC_1, kind: 'entry', currency: 'CUP', unitCost: 2, quantity: 5 }]),
    });
    const report = await new GetSummaryByLocation(uow).execute(owner(), {});
    expect(reader.salesTotals).toHaveBeenCalledWith(expect.anything(), true);
    expect(report.locations).toEqual([
      {
        locationId: LOC_1,
        locationName: 'Centro',
        currencies: [
          { currency: 'CUP', cashSales: 0, transferSales: 0, totalSales: 0, profit: 0, margin: null, tickets: 0, averageTicket: null, shrinkageLoss: 0, ownerWithdrawals: 0, valuedEntries: 10 },
        ],
      },
      {
        locationId: LOC_2,
        locationName: 'Playa',
        currencies: [
          { currency: 'CUP', cashSales: 100, transferSales: 0, totalSales: 100, profit: 40, margin: 0.4, tickets: 1, averageTicket: 100, shrinkageLoss: 0, ownerWithdrawals: 0, valuedEntries: 0 },
        ],
      },
    ]);
  });
});

describe('GetInventoryHealth', () => {
  const pair = (n: number, overrides: Partial<PairHealthRecord> = {}): PairHealthRecord => ({
    locationId: LOC_1,
    productId: `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    name: `P${String(n).padStart(2, '0')}`,
    unitOfMeasure: 'ud',
    category: null,
    currency: 'CUP',
    lowStockThreshold: null,
    expirationDate: null,
    archived: false,
    quantity: 10,
    averageCost: 1.5,
    lastSaleDate: '2026-11-20',
    ...overrides,
  });

  it('applies the domain rules on today of the tenant zone and caps every list', async () => {
    const low = Array.from({ length: MAX_HEALTH_ITEMS + 2 }, (_, i) => pair(i, { quantity: 1, lowStockThreshold: 3 }));
    const pairs = [
      ...low,
      pair(50, { category: 'Bebidas', quantity: 20 }), // Bebidas: 24 → low
      pair(51, { lastSaleDate: '2026-11-14' }), // 7 days → stagnant
      pair(52, { lastSaleDate: null }), // never sold → stagnant
      pair(53, { expirationDate: '2026-11-28' }), // 7 days ahead → near
      pair(54, { expirationDate: '2026-11-29' }), // 8 days ahead → not near
      pair(55, { expirationDate: '2026-11-22', quantity: 0, lastSaleDate: '2026-11-21' }), // no stock: low, not near
      pair(56, { archived: true, quantity: 4, averageCost: 2, lastSaleDate: null }), // only in the value
      pair(57, { currency: 'USD', quantity: 3, averageCost: 0.333333 }), // 3 < 5 → low
    ];
    const { reader, uow } = fakeReader({ pairHealth: vi.fn(async () => pairs) });
    const report = await new GetInventoryHealth(uow).execute(owner(), { locationId: LOC_1 });
    expect(reader.pairHealth).toHaveBeenCalledWith([LOC_1], 'America/Havana');
    expect(report).toMatchObject({ locationIds: [LOC_1], timeZone: 'America/Havana', asOf: AS_OF.toISOString() });
    expect(report.lowStock.count).toBe(MAX_HEALTH_ITEMS + 2 + 3);
    expect(report.lowStock.items).toHaveLength(MAX_HEALTH_ITEMS);
    expect(report.lowStock.items[0]).toEqual({ productId: low[0]!.productId, locationId: LOC_1, name: 'P00', unitOfMeasure: 'ud', quantity: 1, threshold: 3 });
    expect(report.stagnant.items.map((i) => [i.name, i.lastSaleDate])).toEqual([
      ['P52', null],
      ['P51', '2026-11-14'],
    ]);
    expect(report.nearExpiration).toEqual({
      count: 1,
      items: [{ productId: pairs[MAX_HEALTH_ITEMS + 5]!.productId, locationId: LOC_1, name: 'P53', unitOfMeasure: 'ud', quantity: 10, expirationDate: '2026-11-28' }],
    });
    // CUP: 12 × 1 × 1.5 + (20 + 10 × 4) × 1.5 + 4 × 2 = 18 + 90 + 8 = 116; USD: 3 × 0.333333 = 0.999999.
    expect(report.inventoryValue).toEqual([
      { currency: 'CUP', amount: 116 },
      { currency: 'USD', amount: 0.999999 },
    ]);
  });

  it('reads every visible location without a locationId, and never another one', async () => {
    const { reader, uow } = fakeReader();
    const report = await new GetInventoryHealth(uow).execute(managerAt(LOC_2), {});
    expect(reader.pairHealth).toHaveBeenCalledWith([LOC_2], 'America/Havana');
    expect(report).toMatchObject({ locationIds: [LOC_2], inventoryValue: [], lowStock: { count: 0, items: [] } });
  });
});
