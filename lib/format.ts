/**
 * Shared currency and number formatting utilities.
 * Single source of truth — replaces the 4 duplicated `formatCurrency` functions
 * that were defined independently in each tab screen.
 */

export function formatCurrency(
  value: number,
  opts?: { compact?: boolean },
): string {
  if (opts?.compact) {
    return `$${value.toLocaleString('es-CU', { maximumFractionDigits: 0 })}`;
  }
  return `$${value.toLocaleString('es-CU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
