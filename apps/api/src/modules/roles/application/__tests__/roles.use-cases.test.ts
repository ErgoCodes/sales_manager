import { describe, expect, it } from 'vitest';

import { actorWith, clock, custom, fakeUow, NOW, oneActiveOwner, owner, OWNER_ROLE, TENANT_SCOPE } from '../../../iam/application/__tests__/admin-fakes';
import { ForbiddenEscalation, InvalidScope, OwnerInvariantViolation, PermissionDenied, ResourceNotFound, RoleInUse, SystemRoleImmutable } from '../../../iam/domain/errors';
import { CreateRole, DeleteRole, ListRoles, UpdateRole } from '../roles.use-cases';

const ROLE_ID = '0190a000-0000-7000-8000-0000000000d1';
const record = { ...custom(ROLE_ID, 'sales:create'), name: 'Caja', createdAt: NOW };
const role = { id: ROLE_ID, key: null, name: 'Caja', isSystem: false, permissions: ['sales:create'], createdAt: '2026-11-05T12:00:00.000Z' };
const request = { actor: owner(), ip: null };
const roleAdmin = () => ({ actor: actorWith([{ role: custom('ra', 'roles:manage', 'sales:create'), scope: TENANT_SCOPE }]), ip: null });

describe('ListRoles', () => {
  it('needs roles:manage, then lists', async () => {
    const { uow, scope } = fakeUow();
    scope.roles.list.mockResolvedValue({ items: [record], nextCursor: null });
    expect(await new ListRoles(uow).execute(owner(), { limit: 5 })).toEqual({ items: [role], nextCursor: null });
    await expect(new ListRoles(uow).execute(actorWith([]), { limit: 5 })).rejects.toThrow(PermissionDenied);
  });
});

describe('CreateRole', () => {
  it('creates and audits', async () => {
    const { uow, scope } = fakeUow();
    scope.roles.create.mockResolvedValue(record);
    expect(await new CreateRole(uow, clock).execute(request, { name: 'Caja', permissions: ['sales:create'] })).toEqual(role);
    expect(scope.roles.create).toHaveBeenCalledWith({ name: 'Caja', permissions: ['sales:create'], now: NOW });
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'role_created', targetId: ROLE_ID, metadata: { name: 'Caja', permissions: ['sales:create'] } }));
  });

  it('rejects permissions the actor does not hold and audits the reason', async () => {
    const { uow, scope } = fakeUow();
    await expect(new CreateRole(uow, clock).execute(roleAdmin(), { name: 'X', permissions: ['sales:void'] })).rejects.toThrow(ForbiddenEscalation);
    expect(scope.roles.create).not.toHaveBeenCalled();
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'escalation_denied', targetType: 'role', targetId: undefined }));
  });

  it('needs roles:manage', async () => {
    const { uow, runs } = fakeUow();
    await expect(new CreateRole(uow, clock).execute({ actor: actorWith([]), ip: null }, { name: 'X', permissions: ['sales:create'] })).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});

describe('UpdateRole', () => {
  it('locks the tenant, validates, updates, checks the Owner invariant and audits before/after', async () => {
    const { uow, scope } = fakeUow();
    scope.roles.findById.mockResolvedValue(record);
    scope.assignments.hasLocationScopedByRole.mockResolvedValue(false);
    scope.roles.update.mockResolvedValue({ ...record, name: 'Caja 2' });
    scope.assignments.ownerCandidates.mockResolvedValue(oneActiveOwner);
    expect(await new UpdateRole(uow).execute(request, ROLE_ID, { name: 'Caja 2' })).toEqual({ ...role, name: 'Caja 2' });
    expect(scope.mutex.lock).toHaveBeenCalledBefore(scope.roles.findById);
    expect(scope.roles.update).toHaveBeenCalledWith(ROLE_ID, { name: 'Caja 2' });
    expect(scope.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'role_updated',
        metadata: { before: { name: 'Caja', permissions: ['sales:create'] }, after: { name: 'Caja 2', permissions: ['sales:create'] } },
      }),
    );
  });

  it('404 for an unknown role, 409 for the Owner role, 422 for admin permissions on a locations-held role', async () => {
    const { uow, scope } = fakeUow();
    const useCase = new UpdateRole(uow);
    scope.roles.findById.mockResolvedValueOnce(null);
    await expect(useCase.execute(request, ROLE_ID, { name: 'X' })).rejects.toThrow(ResourceNotFound);
    scope.roles.findById.mockResolvedValueOnce({ ...OWNER_ROLE, name: 'Owner', createdAt: NOW });
    await expect(useCase.execute(request, ROLE_ID, { name: 'X' })).rejects.toThrow(SystemRoleImmutable);
    scope.roles.findById.mockResolvedValueOnce(record);
    scope.assignments.hasLocationScopedByRole.mockResolvedValueOnce(true);
    await expect(useCase.execute(request, ROLE_ID, { permissions: ['sales:create', 'users:manage'] })).rejects.toThrow(InvalidScope);
    expect(scope.roles.update).not.toHaveBeenCalled();
  });

  it('rolls back when the Owner invariant breaks', async () => {
    const { uow, scope } = fakeUow();
    scope.roles.findById.mockResolvedValue(record);
    scope.roles.update.mockResolvedValue(record);
    scope.assignments.ownerCandidates.mockResolvedValue([]);
    await expect(new UpdateRole(uow).execute(request, ROLE_ID, { name: 'X' })).rejects.toThrow(OwnerInvariantViolation);
    expect(scope.audit.record).not.toHaveBeenCalled();
  });
});

describe('DeleteRole', () => {
  it('locks, checks deletability and coverage, deletes and audits', async () => {
    const { uow, scope } = fakeUow();
    scope.roles.findById.mockResolvedValue(record);
    scope.assignments.countByRole.mockResolvedValue(0);
    scope.assignments.ownerCandidates.mockResolvedValue(oneActiveOwner);
    await new DeleteRole(uow).execute(request, ROLE_ID);
    expect(scope.mutex.lock).toHaveBeenCalledBefore(scope.roles.findById);
    expect(scope.roles.delete).toHaveBeenCalledWith(ROLE_ID);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'role_deleted', targetId: ROLE_ID }));
  });

  it('404 unknown, 409 system or in use, 403 when the actor cannot cover its permissions', async () => {
    const { uow, scope } = fakeUow();
    const useCase = new DeleteRole(uow);
    scope.roles.findById.mockResolvedValueOnce(null);
    await expect(useCase.execute(request, ROLE_ID)).rejects.toThrow(ResourceNotFound);
    scope.roles.findById.mockResolvedValueOnce({ ...OWNER_ROLE, name: 'Owner', createdAt: NOW });
    await expect(useCase.execute(request, ROLE_ID)).rejects.toThrow(SystemRoleImmutable);
    scope.roles.findById.mockResolvedValueOnce(record);
    scope.assignments.countByRole.mockResolvedValueOnce(2);
    await expect(useCase.execute(request, ROLE_ID)).rejects.toThrow(RoleInUse);
    scope.roles.findById.mockResolvedValueOnce({ ...record, permissions: ['sales:void'] });
    scope.assignments.countByRole.mockResolvedValueOnce(0);
    await expect(useCase.execute(roleAdmin(), ROLE_ID)).rejects.toThrow(ForbiddenEscalation);
    expect(scope.roles.delete).not.toHaveBeenCalled();
  });
});
