import { z } from 'zod';

import { IsoDateTime, Paginated, Uuid } from '../common';

const name = z.string().trim().min(1).max(100);
const code = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'Letters, digits, "-" and "_" only (max 32)')
  .meta({ description: 'Short code, unique per tenant' });

export const Location = z
  .object({
    id: Uuid,
    name: z.string(),
    code: z.string(),
    archivedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'Location' });
export type Location = z.infer<typeof Location>;

export const PaginatedLocations = Paginated(Location, 'PaginatedLocations');

export const CreateLocationRequest = z.object({ name, code }).meta({ id: 'CreateLocationRequest' });
export type CreateLocationRequest = z.infer<typeof CreateLocationRequest>;

export const UpdateLocationRequest = z
  .object({ name: name.optional(), code: code.optional() })
  .refine((v) => v.name !== undefined || v.code !== undefined, 'At least one field is required')
  .meta({ id: 'UpdateLocationRequest' });
export type UpdateLocationRequest = z.infer<typeof UpdateLocationRequest>;
