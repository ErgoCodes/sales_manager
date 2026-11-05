import { describe, expect, it } from 'vitest';

import type { AdminRequest } from '../../../iam/application/admin-support';
import {
  actorWith,
  CASHIER_ROLE,
  clock,
  custom,
  fakeUow,
  LOC_1,
  LOC_2,
  MANAGER_ROLE,
  NOW,
  oneActiveOwner,
  owner,
  TARGET_ID,
  TENANT_SCOPE,
} from '../../../iam/application/__tests__/admin-fakes';
import { ForbiddenEscalation, InvalidScope, OwnerInvariantViolation, PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import { ReplaceAssignments } from '../replace-assignments.use-case';

const request: AdminRequest = { actor: owner(), ip: '203.0.113.7' };
const managed = { id: TARGET_ID, email: 't@a.example', displayName: 'T', status: 'active', mustChangePassword: false, createdAt: NOW };
const cashierAt1 = { roleId: CASHIER_ROLE.id, scope: { type: 'locations' as const, locationIds: [LOC_1] } };
const stored = [{ id: 'as1', roleId: CASHIER_ROLE.id, roleKey: 'cashier' as const, isSystem: true, permissions: CASHIER_ROLE.permissions, scope: 'locations' as const, locationIds: [LOC_1] }];

function ready() {
  const fake = fakeUow();
  fake.scope.userAdmin.findById.mockResolvedValue(managed);
  fake.scope.assignments.listByUser.mockResolvedValue(stored);
  fake.scope.roles.findByIds.mockResolvedValue([{ ...MANAGER_ROLE, name: 'Manager', createdAt: NOW }]);
  fake.scope.locations.findActiveIds.mockResolvedValue([LOC_2]);
  fake.scope.assignments.replace.mockResolvedValue([{ id: 'new', roleId: MANAGER_ROLE.id, scope: { type: 'locations', locationIds: [LOC_2] } }]);
  fake.scope.assignments.ownerCandidates.mockResolvedValue(oneActiveOwner);
  return fake;
}
const managerAt2 = { assignments: [{ roleId: MANAGER_ROLE.id, scope: { type: 'locations' as const, locationIds: [LOC_2] } }] };

describe('ReplaceAssignments', () => {
  it('locks, validates, replaces, checks the invariant and audits before/after', async () => {
    const { uow, scope } = ready();
    expect(await new ReplaceAssignments(uow, clock).execute(request, TARGET_ID, managerAt2)).toEqual({
      assignments: [{ id: 'new', roleId: MANAGER_ROLE.id, scope: { type: 'locations', locationIds: [LOC_2] } }],
    });
    expect(scope.mutex.lock).toHaveBeenCalledBefore(scope.userAdmin.findById);
    expect(scope.roles.findByIds).toHaveBeenCalledWith([MANAGER_ROLE.id]);
    expect(scope.locations.findActiveIds).toHaveBeenCalledWith([LOC_2]);
    expect(scope.assignments.replace).toHaveBeenCalledWith(TARGET_ID, managerAt2.assignments, NOW);
    expect(scope.audit.record).toHaveBeenCalledWith({
      type: 'assignments_replaced',
      actorUserId: request.actor.userId,
      targetType: 'user',
      targetId: TARGET_ID,
      metadata: { before: [cashierAt1], after: managerAt2.assignments },
      ip: '203.0.113.7',
    });
  });

  it('an empty set needs no role or location', async () => {
    const { uow, scope } = ready();
    scope.roles.findByIds.mockResolvedValue([]);
    scope.locations.findActiveIds.mockResolvedValue([]);
    scope.assignments.replace.mockResolvedValue([{ id: 'n', roleId: 'r', scope: { type: 'tenant' } }]);
    expect((await new ReplaceAssignments(uow, clock).execute(request, TARGET_ID, { assignments: [] })).assignments).toEqual([
      { id: 'n', roleId: 'r', scope: { type: 'tenant' } },
    ]);
  });

  it('404 for an unknown user, role or (archived) location', async () => {
    const useCase = (fake: ReturnType<typeof ready>) => new ReplaceAssignments(fake.uow, clock).execute(request, TARGET_ID, managerAt2);
    const noUser = ready();
    noUser.scope.userAdmin.findById.mockResolvedValue(null);
    await expect(useCase(noUser)).rejects.toThrow(ResourceNotFound);
    const noRole = ready();
    noRole.scope.roles.findByIds.mockResolvedValue([]);
    await expect(useCase(noRole)).rejects.toThrow(ResourceNotFound);
    const noLocation = ready();
    noLocation.scope.locations.findActiveIds.mockResolvedValue([]);
    await expect(useCase(noLocation)).rejects.toThrow(ResourceNotFound);
    expect(noLocation.scope.assignments.replace).not.toHaveBeenCalled();
  });

  it('403 escalation (audited), 422 admin permission per location, 409 last Owner', async () => {
    const self = ready();
    await expect(new ReplaceAssignments(self.uow, clock).execute({ actor: actorWith([{ role: custom('x', 'users:manage', 'roles:manage'), scope: TENANT_SCOPE }], TARGET_ID), ip: null }, TARGET_ID, managerAt2)).rejects.toThrow(ForbiddenEscalation);
    expect(self.scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'escalation_denied' }));

    const admin = ready();
    admin.scope.roles.findByIds.mockResolvedValue([{ ...custom('adm', 'locations:manage'), name: 'A', createdAt: NOW }]);
    await expect(new ReplaceAssignments(admin.uow, clock).execute(request, TARGET_ID, { assignments: [{ roleId: 'adm', scope: { type: 'locations', locationIds: [LOC_2] } }] })).rejects.toThrow(InvalidScope);

    const last = ready();
    last.scope.assignments.ownerCandidates.mockResolvedValue([]);
    await expect(new ReplaceAssignments(last.uow, clock).execute(request, TARGET_ID, managerAt2)).rejects.toThrow(OwnerInvariantViolation);
    expect(last.scope.audit.record).not.toHaveBeenCalled();
  });

  it('needs users:manage and roles:manage before touching data', async () => {
    const { uow, runs } = ready();
    const onlyUsers = actorWith([{ role: custom('u', 'users:manage'), scope: TENANT_SCOPE }]);
    await expect(new ReplaceAssignments(uow, clock).execute({ actor: onlyUsers, ip: null }, TARGET_ID, managerAt2)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});
