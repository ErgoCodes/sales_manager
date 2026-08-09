import { differenceInCalendarDays, parseISO } from 'date-fns';

export const STAGNANT_DAYS_THRESHOLD = 7;
export const EXPIRATION_WARNING_DAYS = 7;

export function isStagnant(params: {
  stock: number;
  lastSaleDate: string | null | undefined;
  today?: Date;
}): boolean {
  if (params.stock <= 0) return false;
  if (!params.lastSaleDate) return true;
  const days = differenceInCalendarDays(params.today ?? new Date(), parseISO(params.lastSaleDate));
  return days >= STAGNANT_DAYS_THRESHOLD;
}

export function isNearExpiration(params: {
  expirationDate: string | null | undefined;
  today?: Date;
}): boolean {
  if (!params.expirationDate) return false;
  const days = differenceInCalendarDays(parseISO(params.expirationDate), params.today ?? new Date());
  return days >= 0 && days <= EXPIRATION_WARNING_DAYS;
}
