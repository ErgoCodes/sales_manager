import { PERMISSIONS, type Permission, type SystemRoleKey } from '@monaco/contracts';

import type { RoleDefinition } from './types';

export interface SystemRoleSpec {
  readonly key: SystemRoleKey;
  readonly name: string;
  /** Scope used when the role is first assigned (seed, tenant creation). */
  readonly defaultScope: 'tenant' | 'locations';
  readonly permissions: readonly Permission[];
}

/** System roles seeded in every tenant (SP2 spec, "Catálogo de permisos"). */
export const SYSTEM_ROLES: Readonly<Record<SystemRoleKey, SystemRoleSpec>> = {
  owner: { key: 'owner', name: 'Owner', defaultScope: 'tenant', permissions: PERMISSIONS },
  manager: {
    key: 'manager',
    name: 'Manager',
    defaultScope: 'locations',
    permissions: [
      'catalog:write',
      'inventory:write',
      'inventory:transfer',
      'sales:create',
      'sales:void',
      'reports:view',
      'cash:close',
      // Only for devices of users inside the manager's locations: see canManageDevicesOf.
      'devices:manage',
    ],
  },
  cashier: {
    key: 'cashier',
    name: 'Cashier',
    defaultScope: 'locations',
    permissions: ['sales:create', 'reports:view', 'cash:close'],
  },
};

export function isOwnerRole(role: Pick<RoleDefinition, 'isSystem' | 'key'>): boolean {
  return role.isSystem && role.key === 'owner';
}
