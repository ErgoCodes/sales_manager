import { z } from 'zod';

import { Uuid } from '../common';

/** Scope of a role assignment: the whole tenant, or an explicit list of locations. */
const TenantScope = z.object({ type: z.literal('tenant') });
const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const AssignmentScope = z
  .discriminatedUnion('type', [
    TenantScope,
    z.object({
      type: z.literal('locations'),
      locationIds: z.array(Uuid).min(1).max(200).refine(uniqueIds, 'locationIds must be unique'),
    }),
  ])
  .meta({ id: 'AssignmentScope', description: 'Tenant-wide, or limited to the listed locations' });
export type AssignmentScope = z.infer<typeof AssignmentScope>;

/**
 * Scope as it appears in RESPONSES: same shape, but without the 200-location input cap
 * (a tenant can have more locations than a request may list; responses must never fail).
 */
export const AssignmentScopeResponse = z
  .discriminatedUnion('type', [
    TenantScope,
    z.object({ type: z.literal('locations'), locationIds: z.array(Uuid).min(1) }),
  ])
  .meta({ id: 'AssignmentScopeResponse', description: 'Tenant-wide, or limited to the listed locations' });
export type AssignmentScopeResponse = z.infer<typeof AssignmentScopeResponse>;
