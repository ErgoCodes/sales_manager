import type { DailySeries, InventoryHealth, ReportSummary, SummaryByLocation, SummaryTotals, TopProducts } from '@/lib/api/types';

/** Report payloads shaped like `packages/contracts/src/reports` responses, for the dashboard tests. */
export const L1 = '018f0000-0000-7000-8000-0000000000b1';
export const L2 = '018f0000-0000-7000-8000-0000000000b2';
export const P1 = '018f0000-0000-7000-8000-000000000001';
export const P2 = '018f0000-0000-7000-8000-000000000002';

const echo = { from: '2026-11-16', to: '2026-11-22', timeZone: 'America/Havana', asOf: '2026-11-22T15:00:00.000Z' };

export const totals = (currency: SummaryTotals['currency'], patch: Partial<SummaryTotals> = {}): SummaryTotals => ({
  currency,
  cashSales: 600000,
  transferSales: 400000,
  totalSales: 1000000,
  profit: 250000,
  margin: 0.25,
  tickets: 40,
  averageTicket: 25000,
  shrinkageLoss: 1200,
  ownerWithdrawals: 800,
  valuedEntries: 300000,
  ...patch,
});

export const summary = (currencies: SummaryTotals[] = [totals('CUP'), totals('USD', { totalSales: 5000, cashSales: 5000, transferSales: 0, profit: 1500, margin: 0.3, tickets: 2, averageTicket: 2500 })]): ReportSummary => ({
  scope: 'location',
  locationIds: [L1, L2],
  ...echo,
  currencies,
});

export const dailySeries = (): DailySeries => ({
  locationIds: [L1, L2],
  ...echo,
  series: [
    {
      currency: 'CUP',
      points: [
        { date: '2026-11-21', totalSales: 400000, profit: 100000 },
        { date: '2026-11-22', totalSales: 600000, profit: -2000 },
      ],
    },
    { currency: 'USD', points: [{ date: '2026-11-22', totalSales: 5000, profit: 1500 }] },
  ],
});

export const topProducts = (by: TopProducts['by'] = 'revenue'): TopProducts => ({
  locationIds: [L1, L2],
  ...echo,
  by,
  items: [
    { productId: P1, name: 'Arroz', unitOfMeasure: 'kg', currency: 'CUP', quantity: 30.5, totalSales: 700000, profit: 150000 },
    { productId: P2, name: 'Leche', unitOfMeasure: 'l', currency: 'CUP', quantity: 12, totalSales: 300000, profit: 100000 },
    { productId: P2, name: 'Café importado', unitOfMeasure: 'u', currency: 'USD', quantity: 2, totalSales: 5000, profit: 1500 },
  ],
});

export const byLocation = (): SummaryByLocation => ({
  ...echo,
  locations: [
    { locationId: L1, locationName: 'Centro', currencies: [totals('CUP', { totalSales: 700000 })] },
    { locationId: L2, locationName: 'Norte', currencies: [totals('CUP', { totalSales: 300000 })] },
  ],
});

export const inventoryHealth = (patch: Partial<InventoryHealth> = {}): InventoryHealth => ({
  locationIds: [L1, L2],
  timeZone: 'America/Havana',
  asOf: '2026-11-22T15:00:00.000Z',
  lowStock: { count: 12, items: [{ productId: P1, locationId: L1, name: 'Arroz', unitOfMeasure: 'kg', quantity: 2, threshold: 6 }] },
  stagnant: { count: 1, items: [{ productId: P2, locationId: L2, name: 'Leche', unitOfMeasure: 'l', quantity: 9, lastSaleDate: null }] },
  nearExpiration: { count: 0, items: [] },
  inventoryValue: [
    { currency: 'CUP', amount: 4500123.4 },
    { currency: 'USD', amount: 12000 },
  ],
  ...patch,
});
