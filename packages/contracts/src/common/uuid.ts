import { z } from 'zod';

/** UUIDv7 (time-ordered) identifier, as a canonical lowercase/uppercase string. */
export const Uuid = z.uuidv7().meta({ id: 'Uuid', description: 'UUIDv7 identifier' });
export type Uuid = z.infer<typeof Uuid>;
