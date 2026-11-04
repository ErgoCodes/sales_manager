import { z } from 'zod';

/**
 * Monetary amount as an integer count of minor units (cents) plus an ISO 4217 currency.
 * See docs/adr/0002-contratos-zod-openapi.md for why it is not a decimal string.
 */
export const Money = z
  .object({
    amount: z.number().int().meta({ description: 'Amount in minor units (cents)' }),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .meta({ description: 'ISO 4217 currency code', example: 'CUP' }),
  })
  .meta({ id: 'Money' });
export type Money = z.infer<typeof Money>;
