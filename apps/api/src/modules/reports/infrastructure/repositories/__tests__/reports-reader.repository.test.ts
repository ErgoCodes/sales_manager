import { describe, expect, it } from 'vitest';

import { fakeTx, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { ReportsReaderRepository } from '../reports-reader.repository';

const LOC = '0190a000-0000-7000-8000-0000000000c1';
const CASHIER = '0190a000-0000-7000-8000-0000000000a1';
const PRODUCT = '0190a000-0000-7000-8000-0000000000d1';
const BOUNDS = ['2026-01-10 05:00:00+00', '2026-01-11 05:00:00+00', '2026-01-12 05:00:00+00'];
const WINDOW_ROW = { bounds: BOUNDS, asOf: '2026-11-21 15:00:00.123456+00' };
const WINDOW = { start: BOUNDS[0]!, end: BOUNDS[2]!, asOf: WINDOW_ROW.asOf };
const filter = { locationIds: [LOC], range: { from: '2026-01-10', to: '2026-01-11' }, timeZone: 'America/Havana' };

describe('ReportsReaderRepository', () => {
  it('reads the clock of the tenant and fails loudly if the tenant row is not visible', async () => {
    const { tx, queries } = fakeTx([{ timeZone: 'America/Havana', asOf: '2026-11-21 15:00:00+00', today: '2026-11-21' }], []);
    const repo = new ReportsReaderRepository(tx, TENANT);
    expect(await repo.clock()).toEqual({ timeZone: 'America/Havana', asOf: new Date('2026-11-21T15:00:00Z'), today: '2026-11-21' });
    expect(queries[0]!.sql).toMatch(/\(now\(\) at time zone t\.time_zone\)::date::text as today/);
    expect(queries[0]!.params).toEqual([TENANT]);
    await expect(repo.clock()).rejects.toThrow(/not visible/);
  });

  it('finds a location (archived too) and lists the active ones by name', async () => {
    const { tx, queries } = fakeTx([{ id: LOC, name: 'Centro' }], [], [{ id: LOC, name: 'Centro' }]);
    const repo = new ReportsReaderRepository(tx, TENANT);
    expect(await repo.findLocation(LOC)).toEqual({ id: LOC, name: 'Centro' });
    expect(await repo.findLocation(LOC)).toBeNull();
    expect(await repo.activeLocations()).toEqual([{ id: LOC, name: 'Centro' }]);
    expect(queries[0]!.sql).not.toMatch(/archived_at/);
    expect(queries[2]!.sql).toMatch(/archived_at is null order by name, id$/);
  });

  it('binds the local-day window once per range as timestamptz parameters, and filters the own sales', async () => {
    const { tx, queries } = fakeTx(
      [WINDOW_ROW],
      [{ locationId: null, currency: 'CUP', cashSales: '300', transferSales: '0', profit: '12.500000', tickets: 2 }],
      [{ locationId: LOC, currency: 'CUP', cashSales: '1', transferSales: '2', profit: '-0.5', tickets: 1 }],
    );
    const repo = new ReportsReaderRepository(tx, TENANT);
    expect(await repo.salesTotals({ ...filter, cashierUserId: CASHIER }, false)).toEqual([
      { locationId: null, currency: 'CUP', cashSales: 300, transferSales: 0, profit: 12.5, tickets: 2 },
    ]);
    expect(await repo.salesTotals(filter, true)).toEqual([{ locationId: LOC, currency: 'CUP', cashSales: 1, transferSales: 2, profit: -0.5, tickets: 1 }]);
    expect(queries).toHaveLength(3);
    // One start per local day plus the end, corrected for a fall-back midnight.
    expect(queries[0]!.sql).toMatch(/array_agg\(\(\(d\.day::timestamp at time zone \$1::text\) - greatest\(interval '0', /);
    expect(queries[0]!.sql).toMatch(/generate_series\(\$\d+::date, \$\d+::date \+ 1, interval '1 day'\) as d\(day\)/);
    expect(queries[0]!.params).toEqual(expect.arrayContaining(['2026-01-10', 'America/Havana', '2026-01-11']));
    const totals = queries[1]!;
    expect(totals.sql).toMatch(/sl\.occurred_at >= \$\d+::timestamptz and sl\.occurred_at < \$\d+::timestamptz and sl\.occurred_at <= \$\d+::timestamptz/);
    expect(totals.sql).not.toMatch(/at time zone|now\(\)/);
    expect(totals.sql).toMatch(/sl\.cashier_user_id = \$\d+::uuid/);
    expect(totals.sql).toMatch(/not exists \(select 1 from inventory_documents r where r\.tenant_id = sl\.tenant_id and r\.reverses_document_id = sl\.sale_id\)/);
    expect(totals.sql).toMatch(/null::uuid as "locationId"/);
    expect(totals.params).toEqual(expect.arrayContaining([TENANT, [LOC], WINDOW.start, WINDOW.end, WINDOW.asOf, CASHIER]));
    expect(queries[2]!.sql).toMatch(/select sl\.location_id as "locationId"/);
    expect(queries[2]!.sql).not.toMatch(/cashier_user_id/);
  });

  it('reads valued ledger quantities of non-reversed exits and entries per unit cost', async () => {
    const { tx, queries } = fakeTx([WINDOW_ROW], [{ locationId: LOC, kind: 'shrinkage', currency: 'CUP', unitCost: '10.500000', quantity: '2.000' }]);
    const repo = new ReportsReaderRepository(tx, TENANT);
    expect(await repo.valuedMovements(filter)).toEqual([{ locationId: LOC, kind: 'shrinkage', currency: 'CUP', unitCost: 10.5, quantity: 2 }]);
    expect(queries[1]!.sql).toMatch(/d\.kind in \('exit', 'entry'\)/);
    expect(queries[1]!.sql).toMatch(/m\.kind in \('shrinkage', 'owner_withdrawal', 'entry'\)/);
    expect(queries[1]!.sql).toMatch(/offset 0/);
    expect(queries[1]!.sql).toMatch(/r\.reverses_document_id = d\.id/);
  });

  it('buckets the daily series by the bounds of the local days and zero-fills every day', async () => {
    const { tx, queries } = fakeTx([WINDOW_ROW], [{ currency: 'CUP', date: '2026-01-10', totalSales: '0', profit: '0' }]);
    const repo = new ReportsReaderRepository(tx, TENANT);
    expect(await repo.dailySales(filter)).toEqual([{ currency: 'CUP', date: '2026-01-10', totalSales: 0, profit: 0 }]);
    expect(queries[1]!.sql).toMatch(/width_bucket\(sl\.occurred_at, \$1::timestamptz\[\]\) as day/);
    expect(queries[1]!.sql).not.toMatch(/at time zone/);
    expect(queries[1]!.sql).toMatch(/generate_series\(1, \$\d+::int\) as d\(day\)/);
    expect(queries[1]!.params[0]).toEqual(BOUNDS);
    expect(queries[1]!.params).toContain(2);
  });

  it.each([
    ['revenue', 'sum(sl.line_total)'],
    ['quantity', 'sum(sl.quantity)'],
    ['profit', 'sum(sl.profit)'],
  ] as const)('ranks products by %s from a closed list', async (by, expression) => {
    const row = { productId: PRODUCT, name: 'Arroz', unitOfMeasure: 'kg', currency: 'CUP', quantity: '1.500', totalSales: '30', profit: '4.25' };
    const { tx, queries } = fakeTx([WINDOW_ROW], [row]);
    const repo = new ReportsReaderRepository(tx, TENANT);
    expect(await repo.topProducts(filter, by, 5)).toEqual([{ ...row, quantity: 1.5, totalSales: 30, profit: 4.25 }]);
    expect(queries[1]!.sql).toContain(`row_number() over (partition by sl.currency order by ${expression} desc, p.name, sl.product_id) as rank`);
    expect(queries[1]!.sql).toMatch(/where rank <= \$\d+\s+order by currency, rank$/);
    expect(queries[1]!.params.at(-1)).toBe(5);
  });

  it('reads the health of every pair at the moment, cut at the bound now()', async () => {
    const row = {
      locationId: LOC,
      productId: PRODUCT,
      name: 'Arroz',
      unitOfMeasure: 'kg',
      category: null,
      currency: 'CUP',
      lowStockThreshold: '2.500',
      expirationDate: '2026-12-01',
      archived: false,
      quantity: '7.250',
      averageCost: '10.000000',
      lastSaleDate: '2026-11-01',
    };
    const { tx, queries } = fakeTx([{ asOf: WINDOW.asOf }], [row, { ...row, lowStockThreshold: null }]);
    const repo = new ReportsReaderRepository(tx, TENANT);
    const pairs = await repo.pairHealth([LOC], 'America/Havana');
    expect(pairs[0]).toEqual({ ...row, lowStockThreshold: 2.5, quantity: 7.25, averageCost: 10 });
    expect(pairs[1]!.lowStockThreshold).toBeNull();
    expect(queries[1]!.sql).toMatch(/sl\.occurred_at <= \$\d+::timestamptz/);
    expect(queries[1]!.sql).toMatch(/order by sl\.occurred_at desc limit 1/);
    expect(queries[1]!.sql).toMatch(/p\.archived_at is null or coalesce\(s\.quantity, 0\) <> 0/);
    expect(queries[1]!.params).toEqual(expect.arrayContaining(['America/Havana', WINDOW.asOf, TENANT, [LOC]]));
  });
});
