import { z } from 'zod';

import { Uuid } from '../common';
import { Email } from './auth';
import { Permission } from './permissions';
import { AssignmentScope } from './scope';

/** One effective permission with the scope it holds in (union over all assignments). */
export const PermissionGrant = z
  .object({ permission: Permission, scope: AssignmentScope })
  .meta({ id: 'PermissionGrant' });
export type PermissionGrant = z.infer<typeof PermissionGrant>;

export const MeResponse = z
  .object({
    user: z.object({
      id: Uuid,
      email: Email,
      displayName: z.string(),
      mustChangePassword: z.boolean(),
    }),
    tenant: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
    deviceId: Uuid,
    permissions: z.array(PermissionGrant).meta({ description: 'For hiding UI only; the API is the authority' }),
  })
  .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof MeResponse>;
