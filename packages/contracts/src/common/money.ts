import { z } from 'zod';

/**
 * Monetary amount as an integer count of minor units (cents) plus a supported currency.
 * See docs/adr/0002-contratos-zod-openapi.md for why it is not a decimal string.
 */
export const Money = z
  .object({
    amount: z.int().nonnegative().meta({ description: 'Non-negative amount in minor units (cents)' }),
    currency: z
      .enum(['CUP', 'USD', 'MLC'])
      .meta({ description: 'Supported currency (MLC is not ISO 4217)', example: 'CUP' }),
  })
  .meta({ id: 'Money' });
export type Money = z.infer<typeof Money>;
