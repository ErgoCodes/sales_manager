import type { Permission } from '@monaco/contracts';

import { SYSTEM_ROLES } from '../system-roles';
import type { Actor, Assignment, RoleDefinition } from '../types';

export const OWNER_ROLE: RoleDefinition = {
  id: 'role-owner',
  key: 'owner',
  isSystem: true,
  permissions: SYSTEM_ROLES.owner.permissions,
};
export const MANAGER_ROLE: RoleDefinition = {
  id: 'role-manager',
  key: 'manager',
  isSystem: true,
  permissions: SYSTEM_ROLES.manager.permissions,
};
export const CASHIER_ROLE: RoleDefinition = {
  id: 'role-cashier',
  key: 'cashier',
  isSystem: true,
  permissions: SYSTEM_ROLES.cashier.permissions,
};

export function customRole(id: string, ...permissions: Permission[]): RoleDefinition {
  return { id, key: null, isSystem: false, permissions };
}

/** Custom admin role: can manage users and roles, plus sales:create. */
export const ADMIN_ROLE = customRole('role-admin', 'users:manage', 'roles:manage', 'sales:create');

export const LOC_A = 'loc-a';
export const LOC_B = 'loc-b';
export const LOC_C = 'loc-c';

export const tenantWide = (role: RoleDefinition): Assignment => ({ role, scope: { type: 'tenant' } });
export const atLocations = (role: RoleDefinition, ...locationIds: string[]): Assignment => ({
  role,
  scope: { type: 'locations', locationIds },
});

export const actor = (userId: string, ...assignments: Assignment[]): Actor => ({ userId, assignments });
