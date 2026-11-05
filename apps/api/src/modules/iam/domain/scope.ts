import { InvalidScope } from './errors';
import { isAdminPermission } from './permissions';
import type { Assignment } from './types';

/**
 * Validates one assignment: a locations scope needs unique, non-empty locations, and
 * administrative permissions (`tenant:manage`, `users:manage`, ...) only make sense
 * tenant-wide. Throws `InvalidScope` (422).
 */
export function assertValidAssignment({ role, scope }: Assignment): void {
  if (scope.type === 'tenant') return;
  if (scope.locationIds.length === 0) throw new InvalidScope('empty_locations');
  if (new Set(scope.locationIds).size !== scope.locationIds.length) throw new InvalidScope('duplicate_locations');
  if (role.permissions.some(isAdminPermission)) throw new InvalidScope('admin_permission_requires_tenant_scope');
}
