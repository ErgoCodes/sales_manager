import { z } from 'zod';

export const HealthResponse = z
  .object({
    status: z.enum(['ok', 'error']),
    version: z.string().min(1),
    db: z.enum(['up', 'down']),
  })
  .meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;
