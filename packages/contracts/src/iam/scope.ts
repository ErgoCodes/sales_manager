import { z } from 'zod';

import { Uuid } from '../common';

/** Scope of a role assignment: the whole tenant, or an explicit list of locations. */
export const AssignmentScope = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('tenant') }),
    z.object({
      type: z.literal('locations'),
      locationIds: z
        .array(Uuid)
        .min(1)
        .max(200)
        .refine((ids) => new Set(ids).size === ids.length, 'locationIds must be unique'),
    }),
  ])
  .meta({ id: 'AssignmentScope', description: 'Tenant-wide, or limited to the listed locations' });
export type AssignmentScope = z.infer<typeof AssignmentScope>;
