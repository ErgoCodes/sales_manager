import { ADMIN_PERMISSIONS, PERMISSIONS, type Permission } from '@monaco/contracts';

import type { Assignment, EffectivePermissions } from './types';

const ADMIN = new Set<Permission>(ADMIN_PERMISSIONS);

export function isAdminPermission(permission: Permission): boolean {
  return ADMIN.has(permission);
}

/**
 * Permissions only an Owner may grant (create/edit a role containing them, or assign
 * a role that contains them). Subset of the admin permissions.
 */
export const OWNER_ONLY_PERMISSIONS = ['users:manage', 'roles:manage', 'tenant:manage', 'audit:view'] as const satisfies readonly Permission[];
const OWNER_ONLY = new Set<Permission>(OWNER_ONLY_PERMISSIONS);

export function isOwnerOnlyPermission(permission: Permission): boolean {
  return OWNER_ONLY.has(permission);
}

/**
 * Union of the assignments. Defense in depth: an administrative permission found in a
 * locations-scoped assignment (which validation forbids) never becomes effective.
 */
export function effectivePermissions(assignments: readonly Assignment[]): EffectivePermissions {
  const tenantWide = new Set<Permission>();
  const byLocation = new Map<string, Set<Permission>>();
  for (const { role, scope } of assignments) {
    if (scope.type === 'tenant') {
      for (const permission of role.permissions) tenantWide.add(permission);
      continue;
    }
    for (const locationId of scope.locationIds) {
      let set = byLocation.get(locationId);
      if (!set) {
        set = new Set();
        byLocation.set(locationId, set);
      }
      for (const permission of role.permissions) {
        if (!isAdminPermission(permission)) set.add(permission);
      }
    }
  }
  return { tenantWide, byLocation };
}

/**
 * The authorization rule: permission + location, never the role name.
 * A tenant-wide permission holds for any location. Without `locationId` only a
 * tenant-wide permission counts (use `hasPermissionAnywhere` for "somewhere" checks).
 */
export function can(effective: EffectivePermissions, permission: Permission, locationId?: string): boolean {
  if (effective.tenantWide.has(permission)) return true;
  if (locationId === undefined) return false;
  return effective.byLocation.get(locationId)?.has(permission) ?? false;
}

/** True if the permission holds tenant-wide or in at least one location. */
export function hasPermissionAnywhere(effective: EffectivePermissions, permission: Permission): boolean {
  if (effective.tenantWide.has(permission)) return true;
  for (const set of effective.byLocation.values()) {
    if (set.has(permission)) return true;
  }
  return false;
}

export interface EffectiveGrant {
  readonly permission: Permission;
  readonly scope:
    | { readonly type: 'tenant' }
    | { readonly type: 'locations'; readonly locationIds: readonly string[] };
}

/** Serializable form for `GET /me` (same shape as the `PermissionGrant` contract), in catalog order. */
export function toGrants(effective: EffectivePermissions): EffectiveGrant[] {
  const grants: EffectiveGrant[] = [];
  for (const permission of PERMISSIONS) {
    if (effective.tenantWide.has(permission)) {
      grants.push({ permission, scope: { type: 'tenant' } });
      continue;
    }
    const locationIds = [...effective.byLocation]
      .filter(([, set]) => set.has(permission))
      .map(([locationId]) => locationId)
      .sort();
    if (locationIds.length > 0) grants.push({ permission, scope: { type: 'locations', locationIds } });
  }
  return grants;
}
