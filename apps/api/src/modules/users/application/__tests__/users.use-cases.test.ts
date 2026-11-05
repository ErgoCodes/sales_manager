import { describe, expect, it, vi } from 'vitest';

import {
  actorWith,
  at,
  CASHIER_ROLE,
  clock,
  fakeUow,
  LOC_1,
  NOW,
  oneActiveOwner,
  owner,
  OWNER_ROLE,
  TARGET_ID,
  TENANT_SCOPE,
} from '../../../iam/application/__tests__/admin-fakes';
import type { AdminRequest } from '../../../iam/application/admin-support';
import { ForbiddenEscalation, OwnerInvariantViolation, PermissionDenied, ResourceConflict, ResourceNotFound } from '../../../iam/domain/errors';
import { CreateUser, DisableUser, GetUser, ListUsers, ResetUserPassword, UpdateUser, USER_CREATE_CONFLICT_MESSAGE } from '../users.use-cases';

const managed = { id: TARGET_ID, email: 't@a.example', displayName: 'T', status: 'active' as const, mustChangePassword: false, createdAt: NOW };
const user = { ...managed, createdAt: '2026-11-05T12:00:00.000Z' };
const EXPIRES = '2026-11-08T12:00:00.000Z';
const hasher = { hash: vi.fn(async (p: string) => `hash(${p})`), verify: vi.fn(), verifyDummy: vi.fn() };
const passwords = { generate: () => 'temporary-password-123' };
const request: AdminRequest = { actor: owner(), ip: '203.0.113.5' };
const nobody: AdminRequest = { actor: actorWith([]), ip: null };
const cashierStored = [{ id: 'as1', roleId: CASHIER_ROLE.id, roleKey: 'cashier' as const, isSystem: true, permissions: CASHIER_ROLE.permissions, scope: 'locations' as const, locationIds: [LOC_1] }];
const ownerStored = [{ id: 'as0', roleId: OWNER_ROLE.id, roleKey: 'owner' as const, isSystem: true, permissions: OWNER_ROLE.permissions, scope: 'tenant' as const, locationIds: [] }];

describe('ListUsers / GetUser', () => {
  it('list needs users:manage', async () => {
    const { uow, scope } = fakeUow();
    scope.userAdmin.list.mockResolvedValue({ items: [managed], nextCursor: null });
    expect(await new ListUsers(uow).execute(owner(), { limit: 5 })).toEqual({ items: [user], nextCursor: null });
    await expect(new ListUsers(uow).execute(nobody.actor, { limit: 5 })).rejects.toThrow(PermissionDenied);
  });

  it('get returns the assignments, leaving out those whose locations are all archived; 404 when missing', async () => {
    const { uow, scope } = fakeUow();
    scope.userAdmin.findById.mockResolvedValueOnce(managed).mockResolvedValueOnce(null);
    scope.assignments.listByUser.mockResolvedValue([...ownerStored, ...cashierStored, { ...cashierStored[0]!, id: 'as2', locationIds: [] }]);
    expect((await new GetUser(uow).execute(owner(), TARGET_ID)).assignments).toEqual([
      { id: 'as0', roleId: OWNER_ROLE.id, scope: { type: 'tenant' } },
      { id: 'as1', roleId: CASHIER_ROLE.id, scope: { type: 'locations', locationIds: [LOC_1] } },
    ]);
    await expect(new GetUser(uow).execute(owner(), TARGET_ID)).rejects.toThrow(ResourceNotFound);
    await expect(new GetUser(uow).execute(nobody.actor, TARGET_ID)).rejects.toThrow(PermissionDenied);
  });
});

describe('CreateUser', () => {
  it('creates with a hashed temporary password that expires in 72 h, and audits', async () => {
    const { uow, scope } = fakeUow();
    scope.userAdmin.create.mockResolvedValue(managed);
    const result = await new CreateUser(uow, hasher, passwords, clock).execute(request, { email: 't@a.example', displayName: 'T' });
    expect(result).toEqual({ user, temporaryPassword: 'temporary-password-123', temporaryPasswordExpiresAt: EXPIRES });
    expect(scope.userAdmin.create).toHaveBeenCalledWith({
      email: 't@a.example', displayName: 'T', passwordHash: 'hash(temporary-password-123)', passwordExpiresAt: new Date(EXPIRES), now: NOW,
    });
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_created', targetId: TARGET_ID, metadata: { email: 't@a.example' } }));
  });

  it('an existing email commits a conflict audit event, then fails with the generic conflict', async () => {
    const { uow, scope } = fakeUow();
    scope.userAdmin.create.mockResolvedValue(null);
    const error = await new CreateUser(uow, hasher, passwords, clock).execute(request, { email: 'x@b.example', displayName: 'X' }).catch((e: unknown) => e);
    expect(error).toEqual(new ResourceConflict(USER_CREATE_CONFLICT_MESSAGE));
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_create_conflict', metadata: { email: 'x@b.example' } }));
  });

  it('needs users:manage', async () => {
    const { uow, runs } = fakeUow();
    await expect(new CreateUser(uow, hasher, passwords, clock).execute(nobody, { email: 'x@a.example', displayName: 'X' })).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});

describe('UpdateUser', () => {
  it('renames after the escalation check, 404 when missing', async () => {
    const { uow, scope } = fakeUow();
    scope.userAdmin.findById.mockResolvedValueOnce(managed).mockResolvedValueOnce(null);
    scope.assignments.listByUser.mockResolvedValue(cashierStored);
    scope.userAdmin.updateDisplayName.mockResolvedValue({ ...managed, displayName: 'U' });
    expect((await new UpdateUser(uow).execute(request, TARGET_ID, { displayName: 'U' })).displayName).toBe('U');
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_updated', targetId: TARGET_ID, metadata: { displayName: 'U' } }));
    await expect(new UpdateUser(uow).execute(request, TARGET_ID, { displayName: 'U' })).rejects.toThrow(ResourceNotFound);
    await expect(new UpdateUser(uow).execute(nobody, TARGET_ID, { displayName: 'U' })).rejects.toThrow(PermissionDenied);
  });

  it('a non-Owner cannot rename an Owner', async () => {
    const { uow, scope } = fakeUow();
    scope.userAdmin.findById.mockResolvedValue(managed);
    scope.assignments.listByUser.mockResolvedValue(ownerStored);
    const usersAdmin = { actor: actorWith([{ role: { id: 'r', key: null, isSystem: false, permissions: ['users:manage'] }, scope: TENANT_SCOPE }]), ip: null };
    await expect(new UpdateUser(uow).execute(usersAdmin, TARGET_ID, { displayName: 'U' })).rejects.toThrow(ForbiddenEscalation);
    expect(scope.userAdmin.updateDisplayName).not.toHaveBeenCalled();
  });
});

describe('DisableUser / ResetUserPassword', () => {
  function ready() {
    const fake = fakeUow();
    fake.scope.userAdmin.findById.mockResolvedValue(managed);
    fake.scope.assignments.listByUser.mockResolvedValue(cashierStored);
    fake.scope.userAdmin.disable.mockResolvedValue({ ...managed, status: 'disabled' });
    fake.scope.devices.revokeAllExcept.mockResolvedValue(['d1', 'd2']);
    fake.scope.assignments.ownerCandidates.mockResolvedValue(oneActiveOwner);
    return fake;
  }

  it('disable: mutex, escalation, disable, revoke every device then their tokens, invariant, audit', async () => {
    const { uow, scope } = ready();
    expect((await new DisableUser(uow, clock).execute(request, TARGET_ID)).status).toBe('disabled');
    expect(scope.mutex.lock).toHaveBeenCalledBefore(scope.userAdmin.findById);
    expect(scope.devices.revokeAllExcept).toHaveBeenCalledWith(TARGET_ID, null, NOW);
    expect(scope.refreshTokens.revokeByDevices).toHaveBeenCalledWith(['d1', 'd2'], 'user_disabled', NOW);
    expect(scope.devices.revokeAllExcept).toHaveBeenCalledBefore(scope.refreshTokens.revokeByDevices);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_disabled', metadata: { revokedDevices: 2 } }));
  });

  it('reset: new temporary password for 72 h, every session revoked, audited', async () => {
    const { uow, scope } = ready();
    expect(await new ResetUserPassword(uow, hasher, passwords, clock).execute(request, TARGET_ID)).toEqual({
      temporaryPassword: 'temporary-password-123',
      temporaryPasswordExpiresAt: EXPIRES,
    });
    expect(scope.userAdmin.setTemporaryPassword).toHaveBeenCalledWith(TARGET_ID, 'hash(temporary-password-123)', new Date(EXPIRES));
    expect(scope.refreshTokens.revokeByDevices).toHaveBeenCalledWith(['d1', 'd2'], 'password_reset', NOW);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_password_reset', metadata: { revokedDevices: 2 } }));
  });

  it('both: 404, 403 on oneself (audited), 409 when no active Owner would remain', async () => {
    for (const run of [
      (uow: ReturnType<typeof fakeUow>['uow'], req = request) => new DisableUser(uow, clock).execute(req, TARGET_ID),
      (uow: ReturnType<typeof fakeUow>['uow'], req = request) => new ResetUserPassword(uow, hasher, passwords, clock).execute(req, TARGET_ID),
    ]) {
      const missing = ready();
      missing.scope.userAdmin.findById.mockResolvedValue(null);
      await expect(run(missing.uow)).rejects.toThrow(ResourceNotFound);

      const self = ready();
      await expect(run(self.uow, { actor: actorWith([{ role: OWNER_ROLE, scope: TENANT_SCOPE }], TARGET_ID), ip: null })).rejects.toThrow(ForbiddenEscalation);
      expect(self.scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'escalation_denied', metadata: expect.objectContaining({ reason: 'self_modification' }) }));

      const last = ready();
      last.scope.assignments.ownerCandidates.mockResolvedValue([]);
      await expect(run(last.uow)).rejects.toThrow(OwnerInvariantViolation);

      await expect(run(ready().uow, nobody)).rejects.toThrow(PermissionDenied);
    }
  });

  it('a locations-scoped admin cannot reach a cashier outside its locations', async () => {
    const { uow } = ready();
    const actor = actorWith([{ role: { id: 'r', key: null, isSystem: false, permissions: ['users:manage'] }, scope: TENANT_SCOPE }, { role: CASHIER_ROLE, scope: at('other') }]);
    await expect(new DisableUser(uow, clock).execute({ actor, ip: null }, TARGET_ID)).rejects.toThrow(ForbiddenEscalation);
  });
});
