import { z } from 'zod';

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().min(1).meta({ description: 'Stable machine-readable error code' }),
      message: z.string().max(500).meta({ description: 'Human-readable message' }),
      details: z
        .array(z.object({ path: z.string(), message: z.string().max(500) }))
        .optional()
        .meta({ description: 'Validation issues only; never stack traces, SQL or internal objects' }),
    }),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
