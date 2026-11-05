import { OwnerInvariantViolation, RoleInUse, SystemRoleImmutable } from './errors';
import { isOwnerRole } from './system-roles';
import type { Assignment, RoleDefinition } from './types';

/** An Owner assignment: the system Owner role with tenant-wide scope. */
export function isOwnerAssignment(assignment: Assignment): boolean {
  return isOwnerRole(assignment.role) && assignment.scope.type === 'tenant';
}

export function holdsOwnerRole(assignments: readonly Assignment[]): boolean {
  return assignments.some(isOwnerAssignment);
}

export interface OwnerCandidate {
  readonly status: 'active' | 'disabled';
  readonly assignments: readonly Assignment[];
}

export function countActiveOwners(users: readonly OwnerCandidate[]): number {
  return users.filter((user) => user.status === 'active' && holdsOwnerRole(user.assignments)).length;
}

/**
 * Owner invariant: every tenant keeps at least one ACTIVE user with the Owner system
 * role tenant-wide. Call it with the state AFTER the mutation (users of the tenant that
 * hold or would hold Owner), once the tenant mutex (`SELECT ... FROM tenants FOR UPDATE`)
 * is taken. Throws `OwnerInvariantViolation` (409).
 */
export function assertOwnerInvariant(usersAfterChange: readonly OwnerCandidate[]): void {
  if (countActiveOwners(usersAfterChange) < 1) throw new OwnerInvariantViolation();
}

/** The Owner role cannot be edited (its permissions are "all"), other system roles can. */
export function assertRoleEditable(role: Pick<RoleDefinition, 'isSystem' | 'key'>): void {
  if (isOwnerRole(role)) throw new SystemRoleImmutable('update');
}

/** System roles are never deleted; a role with assignments is not deleted either. */
export function assertRoleDeletable(role: Pick<RoleDefinition, 'isSystem'>, assignmentCount: number): void {
  if (role.isSystem) throw new SystemRoleImmutable('delete');
  if (assignmentCount > 0) throw new RoleInUse();
}
