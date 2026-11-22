import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getProductThreshold } from './catalog';
export const STAGNANT_DAYS_THRESHOLD = 7;
export const EXPIRATION_WARNING_DAYS = 7;
export function isStagnant(params: { stock: number; lastSaleDate: string | null | undefined; today?: Date }): boolean { if (params.stock <= 0) return false; if (!params.lastSaleDate) return true; return differenceInCalendarDays(params.today ?? new Date(), parseISO(params.lastSaleDate)) >= STAGNANT_DAYS_THRESHOLD; }
export function isNearExpiration(params: { expirationDate: string | null | undefined; today?: Date }): boolean { if (!params.expirationDate) return false; const days = differenceInCalendarDays(parseISO(params.expirationDate), params.today ?? new Date()); return days >= 0 && days <= EXPIRATION_WARNING_DAYS; }

/** General low-stock threshold when the tenant has not configured one (mobile: `umbralGeneral`). */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** Low stock: `stock < getProductThreshold(product, generalThreshold)`, the rule of mobile's `countLowStock`. */
export function isLowStock(
  stock: number,
  product: { lowStockThreshold: number | null; category: string | null },
  generalThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
): boolean {
  return stock < getProductThreshold(product, generalThreshold);
}
