import { describe, expect, it } from 'vitest';

import { actorWith, at, CASHIER_ROLE, clock, fakeUow, LOC_1, NOW, owner, TENANT } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied, ResourceNotFound } from '../../../iam/domain/errors';
import { ArchiveLocation, CreateLocation, ListLocations, UpdateLocation } from '../locations.use-cases';

const record = { id: LOC_1, name: 'Norte', code: 'N1', archivedAt: null, createdAt: NOW };
const location = { id: LOC_1, name: 'Norte', code: 'N1', archivedAt: null, createdAt: '2026-11-05T12:00:00.000Z' };
const cashier = () => actorWith([{ role: CASHIER_ROLE, scope: at(LOC_1) }]);

describe('ListLocations', () => {
  it('lists everything to a holder of any tenant-wide permission', async () => {
    const { uow, scope, runs } = fakeUow();
    scope.locations.list.mockResolvedValue({ items: [record], nextCursor: 'c' });
    expect(await new ListLocations(uow).execute(owner(), { limit: 5 })).toEqual({ items: [location], nextCursor: 'c' });
    expect(scope.locations.list).toHaveBeenCalledWith({ limit: 5, onlyIds: undefined });
    expect(runs).toEqual([TENANT]);
  });

  it('restricts a locations-scoped user to their locations', async () => {
    const { uow, scope } = fakeUow();
    scope.locations.list.mockResolvedValue({ items: [], nextCursor: null });
    await new ListLocations(uow).execute(cashier(), { limit: 5, cursor: 'x' });
    expect(scope.locations.list).toHaveBeenCalledWith({ limit: 5, cursor: 'x', onlyIds: [LOC_1] });
  });
});

describe('location mutations', () => {
  const request = { actor: owner(), ip: '203.0.113.1' };

  it('create: authorizes, creates and audits', async () => {
    const { uow, scope } = fakeUow();
    scope.locations.create.mockResolvedValue(record);
    expect(await new CreateLocation(uow, clock).execute(request, { name: 'Norte', code: 'N1' })).toEqual(location);
    expect(scope.locations.create).toHaveBeenCalledWith({ name: 'Norte', code: 'N1', now: NOW });
    expect(scope.audit.record).toHaveBeenCalledWith({
      type: 'location_created', actorUserId: request.actor.userId, targetType: 'location', targetId: LOC_1, metadata: { name: 'Norte', code: 'N1' }, ip: '203.0.113.1',
    });
  });

  it('update: 404 when missing, otherwise updates and audits the changes', async () => {
    const { uow, scope } = fakeUow();
    scope.locations.update.mockResolvedValueOnce(null).mockResolvedValueOnce(record);
    const useCase = new UpdateLocation(uow);
    await expect(useCase.execute(request, LOC_1, { name: 'Norte' })).rejects.toThrow(ResourceNotFound);
    expect(scope.audit.record).not.toHaveBeenCalled();
    expect(await useCase.execute(request, LOC_1, { name: 'Norte' })).toEqual(location);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'location_updated', targetId: LOC_1, metadata: { name: 'Norte' } }));
  });

  it('archive: 404 when missing, audits only the first archive', async () => {
    const { uow, scope } = fakeUow();
    scope.locations.archive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...record, archivedAt: NOW })
      .mockResolvedValueOnce({ ...record, archivedAt: new Date('2026-01-01T00:00:00Z') });
    const useCase = new ArchiveLocation(uow, clock);
    await expect(useCase.execute(request, LOC_1)).rejects.toThrow(ResourceNotFound);
    expect((await useCase.execute(request, LOC_1)).archivedAt).toBe('2026-11-05T12:00:00.000Z');
    expect((await useCase.execute(request, LOC_1)).archivedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(scope.audit.record).toHaveBeenCalledTimes(1);
    expect(scope.audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'location_archived', targetId: LOC_1 }));
  });

  it('every mutation needs locations:manage tenant-wide, before touching data', async () => {
    const { uow, runs } = fakeUow();
    const denied = { actor: cashier(), ip: null };
    await expect(new CreateLocation(uow, clock).execute(denied, { name: 'X', code: 'X' })).rejects.toThrow(PermissionDenied);
    await expect(new UpdateLocation(uow).execute(denied, LOC_1, { name: 'X' })).rejects.toThrow(PermissionDenied);
    await expect(new ArchiveLocation(uow, clock).execute(denied, LOC_1)).rejects.toThrow(PermissionDenied);
    expect(runs).toEqual([]);
  });
});
