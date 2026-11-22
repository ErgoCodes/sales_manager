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
      'catalog:view',
      'catalog:write',
      'inventory:view',
      'inventory:write',
      'inventory:transfer',
      'sales:create',
      'sales:void',
      'reports:view',
      // SP4 · D4: a subset of reports:view, held so the no-escalation rule still lets the Manager
      // assign and manage Cashiers (who have reports:view_own). Its visible access does not change.
      'reports:view_own',
      'cash:close',
      // Only for devices of users inside the manager's locations: see canManageDevicesOf.
      'devices:manage',
    ],
  },
  cashier: {
    key: 'cashier',
    name: 'Cashier',
    defaultScope: 'locations',
    // SP4 · D4: the Cashier's "own close" is reports:view_own (own sales, no costs), not reports:view.
    permissions: ['catalog:view', 'inventory:view', 'sales:create', 'reports:view_own', 'cash:close'],
  },
};

export function isOwnerRole(role: Pick<RoleDefinition, 'isSystem' | 'key'>): boolean {
  return role.isSystem && role.key === 'owner';
}
