import { z } from 'zod';

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().min(1).meta({ description: 'Stable machine-readable error code' }),
      message: z.string().meta({ description: 'Human-readable message' }),
      details: z.unknown().optional().meta({ description: 'Optional structured details' }),
    }),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
