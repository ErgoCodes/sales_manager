import { CURRENCIES, type CurrencyCode, type SummaryTotals } from '@monaco/contracts';
import { averageTicket, costValue, lossValue, marginRatio } from '@monaco/domain';

import type { SalesTotalsRecord, ValuedMovementKind, ValuedQuantityRecord } from '../domain/reports-ports';

const byCurrencyOrder = (a: CurrencyCode, b: CurrencyCode) => CURRENCIES.indexOf(a) - CURRENCIES.indexOf(b);

/** `Σ |quantity| × unit cost` of one kind and currency: the domain rule, never SQL arithmetic. */
function valueOf(valued: readonly ValuedQuantityRecord[], kind: ValuedMovementKind, currency: CurrencyCode): number {
  const movements = valued
    .filter((record) => record.kind === kind && record.currency === currency)
    .map((record) => ({ quantityDelta: record.quantity, unitCost: record.unitCost }));
  return kind === 'entry' ? costValue(movements) : lossValue(movements);
}

/**
 * The KPIs of each currency with data (spec "KPIs"), in catalog currency order.
 * `sales` holds at most one row per currency; `withCosts` is false for
 * `reports:view_own`, whose profit, margin and valued losses are null (D4).
 */
export function summarize(sales: readonly SalesTotalsRecord[], valued: readonly ValuedQuantityRecord[], withCosts: boolean): SummaryTotals[] {
  const currencies = new Set<CurrencyCode>(sales.map((row) => row.currency));
  if (withCosts) for (const row of valued) currencies.add(row.currency);
  return [...currencies].sort(byCurrencyOrder).map((currency) => {
    const row = sales.find((candidate) => candidate.currency === currency);
    const cashSales = row?.cashSales ?? 0;
    const transferSales = row?.transferSales ?? 0;
    const totalSales = cashSales + transferSales;
    const tickets = row?.tickets ?? 0;
    const profit = row?.profit ?? 0;
    return {
      currency,
      cashSales,
      transferSales,
      totalSales,
      profit: withCosts ? profit : null,
      margin: withCosts ? marginRatio(profit, totalSales) : null,
      tickets,
      averageTicket: averageTicket(totalSales, tickets),
      shrinkageLoss: withCosts ? valueOf(valued, 'shrinkage', currency) : null,
      ownerWithdrawals: withCosts ? valueOf(valued, 'owner_withdrawal', currency) : null,
      valuedEntries: withCosts ? valueOf(valued, 'entry', currency) : null,
    };
  });
}
