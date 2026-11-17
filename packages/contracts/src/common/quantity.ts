import { z } from 'zod';

/** numeric(14,3): 11 integer digits and 3 decimals. */
const MAX_QUANTITY = 99_999_999_999.999;

function hasAtMostThreeDecimals(value: number): boolean {
  const scaled = value * 1000;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

const base = z
  .number()
  .refine(Number.isFinite, 'Must be a finite number')
  .refine((v) => Math.abs(v) <= MAX_QUANTITY, 'Out of range')
  .refine(hasAtMostThreeDecimals, 'At most 3 decimals');

/** Strictly positive quantity with at most 3 decimals (kg, litres). */
export const Quantity = base
  .refine((v) => v > 0, 'Must be greater than zero')
  .meta({ id: 'Quantity', description: 'Positive quantity, at most 3 decimals' });
export type Quantity = z.infer<typeof Quantity>;

/** Non-zero quantity with sign (adjustments, movement deltas), at most 3 decimals. */
export const SignedQuantity = base
  .refine((v) => v !== 0, 'Must not be zero')
  .meta({ id: 'SignedQuantity', description: 'Non-zero signed quantity, at most 3 decimals' });
export type SignedQuantity = z.infer<typeof SignedQuantity>;

/**
 * Average cost in minor units with sub-cent fraction (numeric(20,6) in the database).
 * `Money` stays integer: see ADR 0002.
 */
export const AverageCost = z
  .object({
    amount: z.number().refine(Number.isFinite).nonnegative().meta({ description: 'Minor units, up to 6 decimals' }),
    currency: z.enum(['CUP', 'USD', 'MLC']),
  })
  .meta({ id: 'AverageCost' });
export type AverageCost = z.infer<typeof AverageCost>;
