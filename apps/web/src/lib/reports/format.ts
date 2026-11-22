import type { CurrencyCode } from '@monaco/contracts';

const money = new Map<CurrencyCode, Intl.NumberFormat>();
const PERCENT = new Intl.NumberFormat('es-CU', { style: 'percent', maximumFractionDigits: 1 });

/**
 * Report amount (minor units, possibly with a sub-cent fraction) in its own currency, with the code
 * (CUP, USD, MLC are all 2-decimal). Never `formatCurrency` of mobile, which fixes `$` (spec SP4).
 */
export function formatAmount(minorUnits: number | null, currency: CurrencyCode): string {
  if (minorUnits === null) return '—';
  let format = money.get(currency);
  if (!format) {
    format = new Intl.NumberFormat('es-CU', { style: 'currency', currency, currencyDisplay: 'code' });
    money.set(currency, format);
  }
  return format.format(minorUnits / 100);
}

/** Margin (a ratio with 4 decimals) as a percentage; null (no sales) is a dash. */
export function formatMargin(margin: number | null): string {
  return margin === null ? '—' : PERCENT.format(margin);
}

const COMPACT = new Intl.NumberFormat('es-CU', { notation: 'compact', maximumFractionDigits: 1 });
const SHORT_DATE = new Intl.DateTimeFormat('es-CU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Chart axis tick: an amount (minor units) in compact notation, without the currency code (the chart names it). */
export function formatCompactAmount(minorUnits: number): string {
  return COMPACT.format(minorUnits / 100);
}

/** Chart axis tick: a report day (`YYYY-MM-DD`, already local to the tenant) as day and short month. */
export function formatShortDate(day: string): string {
  return SHORT_DATE.format(new Date(`${day}T00:00:00Z`));
}
