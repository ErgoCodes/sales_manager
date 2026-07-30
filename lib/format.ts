const LOCALE = 'es-CU';

export function formatCurrency(value: number, opts?: { compact?: boolean }): string {
  if (opts?.compact) return `$${value.toLocaleString(LOCALE, { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
