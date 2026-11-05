import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { RoleInUse } from '../../../iam/domain/errors';
import type { CreateRole, DeleteRole, ListRoles, UpdateRole } from '../../application/roles.use-cases';
import { RolesController } from '../roles.controller';

const ID = '0190a000-0000-7000-8000-000000000002';

describe('RolesController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const useCase = { execute } as never;
  const controller = new RolesController(useCase as ListRoles, useCase as CreateRole, useCase as UpdateRole, useCase as DeleteRole);
  const actor = owner();

  it('delegates every route to its use case', async () => {
    await controller.list(actor, { limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, { limit: 5 });
    await controller.create(actor, '10.0.0.1', { name: 'N', permissions: ['sales:create'] });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: '10.0.0.1' }, { name: 'N', permissions: ['sales:create'] });
    await controller.update(actor, null, { id: ID }, { name: 'N' });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID, { name: 'N' });
    await expect(controller.remove(actor, null, { id: ID })).resolves.toBeUndefined();
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID);
  });

  it('maps domain errors to HTTP', async () => {
    execute.mockRejectedValueOnce(new RoleInUse());
    await expect(controller.remove(actor, null, { id: ID })).rejects.toBeInstanceOf(ConflictException);
  });
});
