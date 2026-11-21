import type { Money } from '@monaco/contracts';
import { calculateTransferPriceMinor, formatCurrency, fromMinorUnits, toMinorUnits } from '@monaco/domain';

/** Every supported currency (CUP, USD, MLC) has two decimals. */
const MONEY_INPUT = /^\d{1,13}(?:[.,]\d{1,2})?$/;

export type MoneyParse = { ok: true; amount: number | null } | { ok: false };

/** Major-unit text typed by the user -> integer minor units. Empty means "no amount" (null). */
export function parseMoneyInput(raw: string): MoneyParse {
  const value = raw.trim();
  if (value === '') return { ok: true, amount: null };
  if (!MONEY_INPUT.test(value)) return { ok: false };
  try {
    return { ok: true, amount: toMinorUnits(Number(value.replace(',', '.'))) };
  } catch {
    /* v8 ignore next */
    return { ok: false };
  }
}

/** Minor units -> the major-unit string an input shows (`1250` -> `"12.50"`). */
export function minorToInput(amount: number | null | undefined): string {
  return amount == null ? '' : fromMinorUnits(amount).toFixed(2);
}

/** Display text for an amount. A null amount (unset or hidden) is a dash, never a zero. */
export function formatMoney(money: Money | null | undefined): string {
  return money ? `${formatCurrency(fromMinorUnits(money.amount))} ${money.currency}` : '—';
}

/** Transfer price proposal from a typed cash price, with the shared domain rule. The API stays the authority. */
export function proposeTransferPrice(cashInput: string): string | null {
  const cash = parseMoneyInput(cashInput);
  if (!cash.ok || !cash.amount) return null;
  return minorToInput(calculateTransferPriceMinor(cash.amount));
}
