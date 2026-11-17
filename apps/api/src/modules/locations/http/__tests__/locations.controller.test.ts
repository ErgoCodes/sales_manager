import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import type { ArchiveLocation, CreateLocation, ListLocations, UpdateLocation } from '../../application/locations.use-cases';
import { LocationsController } from '../locations.controller';

const ID = '0190a000-0000-7000-8000-000000000002';

describe('LocationsController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const useCase = { execute } as never;
  const controller = new LocationsController(useCase as ListLocations, useCase as CreateLocation, useCase as UpdateLocation, useCase as ArchiveLocation);
  const actor = owner();

  it('delegates every route to its use case with the actor and the client IP', async () => {
    await controller.list(actor, { limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, { limit: 5 });
    await controller.create(actor, '10.0.0.1', { name: 'N', code: 'N' });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: '10.0.0.1' }, { name: 'N', code: 'N' });
    await controller.update(actor, null, { id: ID }, { name: 'N' });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID, { name: 'N' });
    expect(await controller.archive(actor, null, { id: ID })).toBe('ok');
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID);
  });

  it('propagates domain errors', async () => {
    execute.mockRejectedValueOnce(new PermissionDenied('locations:manage'));
    await expect(controller.archive(actor, null, { id: ID })).rejects.toBeInstanceOf(PermissionDenied);
  });
});
