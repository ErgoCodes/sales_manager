import type { Permission } from '@monaco/contracts';

import { ForbiddenEscalation, InvalidScope, type EscalationReason } from './errors';
import { assertRoleEditable, holdsOwnerRole } from './owner';
import {
  effectivePermissions,
  hasPermissionAnywhere,
  isAdminPermission,
  isOwnerOnlyPermission,
} from './permissions';
import { assertValidAssignment } from './scope';
import type { Actor, Assignment, EffectivePermissions, RoleDefinition, Scope } from './types';

/**
 * A privileged change to check. The caller (application layer) has ALREADY authorized the
 * base permission (`users:manage`, `roles:manage`, ...) with `can`; this only answers
 * "may this actor hand out / touch exactly this?".
 */
export type EscalationCheck =
  /** `POST /roles`. */
  | { readonly kind: 'create_role'; readonly permissions: readonly Permission[] }
  /** `PATCH /roles/:id`; `permissions` is the resulting set (pass the current one for a rename). */
  | {
      readonly kind: 'update_role';
      readonly role: RoleDefinition;
      readonly permissions: readonly Permission[];
      /** True if any user holds this role with a locations scope (admin permissions cannot be added then). */
      readonly hasLocationScopedAssignments: boolean;
    }
  /** `PUT /users/:id/assignments`. */
  | {
      readonly kind: 'replace_assignments';
      readonly targetUserId: string;
      readonly current: readonly Assignment[];
      readonly next: readonly Assignment[];
    }
  /** `POST /users/:id/disable`, `POST /users/:id/reset-password` and `PATCH /users/:id`. */
  | {
      readonly kind: 'disable_user' | 'reset_password' | 'update_user';
      readonly targetUserId: string;
      readonly targetAssignments: readonly Assignment[];
    };

const TENANT: Scope = { type: 'tenant' };

/**
 * Why `permissions` cannot be handed out at `scope` by someone with `effective`, or null if they can.
 * Rules: owner-only permissions need an Owner; the actor must hold each permission with a scope
 * equal or wider (tenant-wide covers everything; a locations scope needs every location covered).
 */
function shortfall(
  effective: EffectivePermissions,
  actorIsOwner: boolean,
  permissions: readonly Permission[],
  scope: Scope,
): EscalationReason | null {
  for (const permission of permissions) {
    if (isOwnerOnlyPermission(permission) && !actorIsOwner) return 'owner_only';
    if (effective.tenantWide.has(permission)) continue;
    if (!hasPermissionAnywhere(effective, permission)) return 'permission_not_held';
    const covered =
      scope.type === 'locations' && scope.locationIds.every((id) => effective.byLocation.get(id)?.has(permission));
    if (!covered) return 'scope_exceeds';
  }
  return null;
}

function assertCovers(
  effective: EffectivePermissions,
  actorIsOwner: boolean,
  permissions: readonly Permission[],
  scope: Scope,
): void {
  const reason = shortfall(effective, actorIsOwner, permissions, scope);
  if (reason) throw new ForbiddenEscalation(reason);
}

/** Canonical key: same role + same scope (location order irrelevant). */
function assignmentKey({ role, scope }: Assignment): string {
  return scope.type === 'tenant' ? `${role.id}|tenant` : `${role.id}|${[...scope.locationIds].sort().join(',')}`;
}

/** Assignments present in exactly one of the two sets. */
function changedAssignments(before: readonly Assignment[], after: readonly Assignment[]): Assignment[] {
  const keysBefore = new Set(before.map(assignmentKey));
  const keysAfter = new Set(after.map(assignmentKey));
  return [
    ...before.filter((a) => !keysAfter.has(assignmentKey(a))),
    ...after.filter((a) => !keysBefore.has(assignmentKey(a))),
  ];
}

/**
 * Privilege-escalation guard shared by every mutation that can hand out or take away
 * privileges. Throws `InvalidScope` (422), `SystemRoleImmutable` (409) or
 * `ForbiddenEscalation` (403); returns normally if the change is allowed.
 *
 * - Roles are scope-less and assignable anywhere, so defining/editing one needs every changed
 *   permission TENANT-WIDE (and being an Owner for owner-only ones). Editing affects all holders.
 * - Assignments: nobody edits their own; only an Owner touches Owner assignments or an Owner user;
 *   every ADDED or REMOVED assignment must be covered by the actor (permission + scope).
 * - Update user: yourself is fine (displayName); otherwise same rules as disable/reset.
 * - Disable/reset: not on yourself (use `/auth/password`); an Owner target needs an Owner actor;
 *   resetting is an account takeover, so the actor must cover everything the target holds.
 */
export function assertNoEscalation(actor: Actor, check: EscalationCheck): void {
  const effective = effectivePermissions(actor.assignments);
  const actorIsOwner = holdsOwnerRole(actor.assignments);

  switch (check.kind) {
    case 'create_role':
      assertCovers(effective, actorIsOwner, check.permissions, TENANT);
      return;

    case 'update_role': {
      assertRoleEditable(check.role);
      const before = new Set(check.role.permissions);
      const after = new Set(check.permissions);
      const changed = [...before, ...after].filter((p) => before.has(p) !== after.has(p));
      if (check.hasLocationScopedAssignments && [...after].some((p) => !before.has(p) && isAdminPermission(p))) {
        throw new InvalidScope('admin_permission_requires_tenant_scope');
      }
      assertCovers(effective, actorIsOwner, changed, TENANT);
      return;
    }

    case 'replace_assignments': {
      if (check.targetUserId === actor.userId) throw new ForbiddenEscalation('self_modification');
      check.next.forEach(assertValidAssignment);
      if ((holdsOwnerRole(check.current) || holdsOwnerRole(check.next)) && !actorIsOwner) {
        throw new ForbiddenEscalation('owner_only');
      }
      for (const { role, scope } of changedAssignments(check.current, check.next)) {
        assertCovers(effective, actorIsOwner, role.permissions, scope);
      }
      return;
    }

    case 'disable_user':
    case 'reset_password':
    case 'update_user': {
      if (check.targetUserId === actor.userId) {
        // Editing your own profile (displayName) is fine; disabling/resetting yourself is not.
        if (check.kind === 'update_user') return;
        throw new ForbiddenEscalation('self_modification');
      }
      if (holdsOwnerRole(check.targetAssignments) && !actorIsOwner) throw new ForbiddenEscalation('owner_only');
      for (const { role, scope } of check.targetAssignments) {
        assertCovers(effective, actorIsOwner, role.permissions, scope);
      }
      return;
    }
  }
}

/**
 * `devices:manage` over ANOTHER user's devices. Tenant-wide holders manage anyone's. A
 * locations-scoped holder (Manager) only manages non-Owner users whose assignments are all
 * locations-scoped and entirely inside the locations where they hold `devices:manage`.
 * A user without assignments is out of any location's reach. An Owner target's devices are
 * managed only by an Owner (which also covers an Owner acting on their own devices).
 */
export function canManageDevicesOf(actor: Actor, targetAssignments: readonly Assignment[]): boolean {
  const targetIsOwner = holdsOwnerRole(targetAssignments);
  if (targetIsOwner && !holdsOwnerRole(actor.assignments)) return false;
  const effective = effectivePermissions(actor.assignments);
  if (effective.tenantWide.has('devices:manage')) return true;
  if (targetAssignments.length === 0 || targetIsOwner) return false;
  return targetAssignments.every(
    ({ scope }) =>
      scope.type === 'locations' && scope.locationIds.every((id) => effective.byLocation.get(id)?.has('devices:manage')),
  );
}
