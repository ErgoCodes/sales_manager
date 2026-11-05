import { z } from 'zod';

import { IsoDateTime, Paginated, Uuid } from '../common';
import { Permission } from './permissions';

export const SystemRoleKey = z.enum(['owner', 'manager', 'cashier']).meta({ id: 'SystemRoleKey' });
export type SystemRoleKey = z.infer<typeof SystemRoleKey>;

export const Role = z
  .object({
    id: Uuid,
    key: SystemRoleKey.nullable().meta({ description: 'Null for custom roles' }),
    name: z.string(),
    isSystem: z.boolean(),
    permissions: z.array(Permission),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'Role' });
export type Role = z.infer<typeof Role>;

export const PaginatedRoles = Paginated(Role, 'PaginatedRoles');

const name = z.string().trim().min(1).max(60);
const permissions = z
  .array(Permission)
  .min(1)
  .refine((p) => new Set(p).size === p.length, 'permissions must be unique');

export const CreateRoleRequest = z.object({ name, permissions }).meta({ id: 'CreateRoleRequest' });
export type CreateRoleRequest = z.infer<typeof CreateRoleRequest>;

export const UpdateRoleRequest = z
  .object({ name: name.optional(), permissions: permissions.optional() })
  .refine((v) => v.name !== undefined || v.permissions !== undefined, 'At least one field is required')
  .meta({ id: 'UpdateRoleRequest' });
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequest>;
