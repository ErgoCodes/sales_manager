import { describe, expect, it } from 'vitest';

import { actorWith, at, CASHIER_ROLE, clock, fakeUow, LOC_1, LOC_2, MANAGER_ROLE, NOW, owner, TARGET_ID } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import { ListDevices, RevokeDevice } from '../devices.use-cases';

const DEVICE = '0190a000-0000-7000-8000-0000000000e1';
const record = (userId: string, revokedAt: Date | null = NOW) => ({ id: DEVICE, userId, label: 'Chrome', platform: 'web' as const, createdAt: NOW, lastSeenAt: null, revokedAt });
const cashierAt = (loc: string) => [{ id: 'a', roleId: CASHIER_ROLE.id, roleKey: 'cashier' as const, isSystem: true, permissions: CASHIER_ROLE.permissions, scope: 'locations' as const, locationIds: [loc] }];
const manager = () => actorWith([{ role: MANAGER_ROLE, scope: at(LOC_1) }]);
const cashier = () => actorWith([{ role: CASHIER_ROLE, scope: at(LOC_1) }]);

describe('ListDevices', () => {
  it("lists the caller's own devices without any permission, marking the current one", async () => {
    const { uow, scope } = fakeUow();
    const actor = cashier();
    scope.deviceAdmin.listByUser.mockResolvedValue({ items: [{ ...record(actor.userId, null), id: actor.deviceId }, record(actor.userId)], nextCursor: null });
    const page = await new ListDevices(uow).execute(actor, { limit: 5 });
    expect(page.items.map((d) => d.current)).toEqual([true, false]);
    expect(page.items[1]).toMatchObject({ createdAt: '2026-11-05T12:00:00.000Z', revokedAt: '2026-11-05T12:00:00.000Z', lastSeenAt: null });
    expect(scope.deviceAdmin.listByUser).toHaveBeenCalledWith(actor.userId, { cursor: undefined, limit: 5 });
    expect(scope.userAdmin.findById).not.toHaveBeenCalled();
  });

  it("another user's: 403 without devices:manage, 404 unknown user, 403 out of reach, else listed", async () => {
    const { uow, scope, runs } = fakeUow();
    await expect(new ListDevices(uow).execute(cashier(), { limit: 5, userId: TARGET_ID })).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);

    scope.userAdmin.findById.mockResolvedValueOnce(null);
    await expect(new ListDevices(uow).execute(manager(), { limit: 5, userId: TARGET_ID })).rejects.toThrow(ResourceNotFound);

    scope.userAdmin.findById.mockResolvedValue({ id: TARGET_ID });
    scope.assignments.listByUser.mockResolvedValueOnce(cashierAt(LOC_2));
    await expect(new ListDevices(uow).execute(manager(), { limit: 5, userId: TARGET_ID })).rejects.toThrow(PermissionDenied);

    scope.assignments.listByUser.mockResolvedValueOnce(cashierAt(LOC_1));
    scope.deviceAdmin.listByUser.mockResolvedValue({ items: [], nextCursor: null });
    expect(await new ListDevices(uow).execute(manager(), { limit: 5, userId: TARGET_ID, cursor: 'c' })).toEqual({ items: [], nextCursor: null });
    expect(scope.deviceAdmin.listByUser).toHaveBeenCalledWith(TARGET_ID, { cursor: 'c', limit: 5 });
  });
});

describe('RevokeDevice', () => {
  it('revokes the device, then its tokens, and audits the first revocation only', async () => {
    const { uow, scope } = fakeUow();
    const actor = owner();
    scope.deviceAdmin.findById.mockResolvedValue(record(actor.userId, null));
    scope.deviceAdmin.revoke.mockResolvedValueOnce(record(actor.userId)).mockResolvedValueOnce(record(actor.userId, new Date(0)));
    const useCase = new RevokeDevice(uow, clock);
    expect((await useCase.execute({ actor, ip: '10.0.0.1' }, DEVICE)).revokedAt).toBe('2026-11-05T12:00:00.000Z');
    expect(scope.refreshTokens.revokeByDevices).toHaveBeenCalledWith([DEVICE], 'device_revoked', NOW);
    expect(scope.deviceAdmin.revoke).toHaveBeenCalledBefore(scope.refreshTokens.revokeByDevices);
    expect(scope.audit.record).toHaveBeenCalledWith({
      type: 'device_revoked', actorUserId: actor.userId, targetType: 'device', targetId: DEVICE, metadata: { userId: actor.userId }, ip: '10.0.0.1',
    });
    await useCase.execute({ actor, ip: null }, DEVICE);
    expect(scope.audit.record).toHaveBeenCalledTimes(1);
  });

  it('404 unknown device; 403 for a device of someone out of reach', async () => {
    const { uow, scope } = fakeUow();
    const useCase = new RevokeDevice(uow, clock);
    scope.deviceAdmin.findById.mockResolvedValueOnce(null);
    await expect(useCase.execute({ actor: manager(), ip: null }, DEVICE)).rejects.toThrow(ResourceNotFound);
    scope.deviceAdmin.findById.mockResolvedValue(record(TARGET_ID, null));
    await expect(useCase.execute({ actor: cashier(), ip: null }, DEVICE)).rejects.toThrow(PermissionDenied);
    scope.userAdmin.findById.mockResolvedValue({ id: TARGET_ID });
    scope.assignments.listByUser.mockResolvedValue(cashierAt(LOC_2));
    await expect(useCase.execute({ actor: manager(), ip: null }, DEVICE)).rejects.toThrow(PermissionDenied);
    expect(scope.deviceAdmin.revoke).not.toHaveBeenCalled();
  });
});
