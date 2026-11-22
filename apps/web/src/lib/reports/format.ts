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
