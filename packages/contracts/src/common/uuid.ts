import { z } from 'zod';

/** UUIDv7 (time-ordered) identifier, in canonical lowercase form (uppercase is rejected). */
export const Uuid = z
  .uuidv7()
  .regex(/^[0-9a-f-]+$/, 'UUID must be lowercase')
  .meta({ id: 'Uuid', description: 'UUIDv7 identifier, canonical lowercase form' });
export type Uuid = z.infer<typeof Uuid>;
