import type { ReplaceAssignmentsRequest, ReplaceAssignmentsResponse } from '@monaco/contracts';

import { type AdminRequest, runAdmin } from '../../iam/application/admin-support';
import { toAssignments, toScope } from '../../iam/application/authenticate.use-case';
import type { AdminUnitOfWork } from '../../iam/domain/admin-ports';
import type { Clock } from '../../iam/domain/auth-ports';
import { ResourceNotFound } from '../../iam/domain/errors';
import { assertNoEscalation } from '../../iam/domain/escalation';
import { assertOwnerInvariant } from '../../iam/domain/owner';
import { authorize } from '../../iam/domain/permissions';
import type { Assignment, Scope } from '../../iam/domain/types';
import type { SavedAssignment } from '../domain/assignment-ports';

export { toScope };

const summary = (assignments: readonly { role: { id: string }; scope: Scope }[]) =>
  assignments.map(({ role, scope }) => ({ roleId: role.id, scope: toScope(scope) }));

/**
 * PUT /users/:id/assignments (`users:manage` + `roles:manage`, both
 * tenant-wide). Replaces the whole set in one transaction:
 *
 * 1. tenant mutex, then the target (404), its current assignments, the roles
 *    (404 if any is unknown, also of another tenant) and the locations (404 if
 *    unknown or archived);
 * 2. `assertNoEscalation` (`replace_assignments`): never one's own, Owner only
 *    by an Owner, every added or removed assignment covered (403), admin
 *    permissions only tenant-wide (422);
 * 3. replace, then the Owner invariant on the resulting state (409).
 */
export class ReplaceAssignments {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, userId: string, input: ReplaceAssignmentsRequest): Promise<ReplaceAssignmentsResponse> {
    const { actor, ip } = request;
    authorize(actor, 'users:manage');
    authorize(actor, 'roles:manage');
    const now = this.clock.now();
    const saved = await runAdmin<SavedAssignment[]>(this.uow, request, 'replace_assignments', { type: 'user', id: userId }, async (scope) => {
      await scope.mutex.lock();
      if (!(await scope.userAdmin.findById(userId))) throw new ResourceNotFound('user');
      const current = toAssignments(await scope.assignments.listByUser(userId));

      const roleIds = [...new Set(input.assignments.map((a) => a.roleId))];
      const roles = new Map((await scope.roles.findByIds(roleIds)).map((role) => [role.id, role]));
      if (roles.size !== roleIds.length) throw new ResourceNotFound('role');
      const locationIds = [...new Set(input.assignments.flatMap((a) => (a.scope.type === 'locations' ? a.scope.locationIds : [])))];
      if ((await scope.locations.findActiveIds(locationIds)).length !== locationIds.length) throw new ResourceNotFound('location');

      const next: Assignment[] = input.assignments.map((a) => ({ role: roles.get(a.roleId)!, scope: a.scope }));
      assertNoEscalation(actor, { kind: 'replace_assignments', targetUserId: userId, current, next });

      const result = await scope.assignments.replace(userId, input.assignments, now);
      assertOwnerInvariant(await scope.assignments.ownerCandidates());
      await scope.audit.record({
        type: 'assignments_replaced',
        actorUserId: actor.userId,
        targetType: 'user',
        targetId: userId,
        metadata: { before: summary(current), after: summary(next) },
        ip,
      });
      return result;
    });
    return { assignments: saved.map((a) => ({ id: a.id, roleId: a.roleId, scope: toScope(a.scope) })) };
  }
}
