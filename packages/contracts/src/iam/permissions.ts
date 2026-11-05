import { z } from 'zod';

/**
 * Permission catalog v1 (SP2 spec). Permissions are code, roles are data.
 * Adding one is a code change plus a data migration for the system roles.
 */
export const PERMISSIONS = [
  'tenant:manage',
  'locations:manage',
  'users:manage',
  'roles:manage',
  'devices:manage',
  'audit:view',
  'catalog:write',
  'inventory:write',
  'inventory:transfer',
  'sales:create',
  'sales:void',
  'reports:view',
  'cash:close',
] as const;

export const Permission = z.enum(PERMISSIONS).meta({ id: 'Permission', description: 'Permission catalog entry' });
export type Permission = z.infer<typeof Permission>;

/**
 * Administrative permissions: they only make sense tenant-wide. Assigning a role that
 * contains any of them with a locations scope is rejected (422).
 */
export const ADMIN_PERMISSIONS = [
  'tenant:manage',
  'locations:manage',
  'users:manage',
  'roles:manage',
  'audit:view',
] as const satisfies readonly Permission[];
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
