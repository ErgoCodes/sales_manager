import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { ResourceConflict } from '../../../iam/domain/errors';
import type { CreateUser, DisableUser, GetUser, ListUsers, ResetUserPassword, UpdateUser } from '../../application/users.use-cases';
import { RandomTemporaryPasswordGenerator } from '../../infrastructure/random-temporary-password';
import { UsersController } from '../users.controller';

const ID = '0190a000-0000-7000-8000-000000000002';

describe('UsersController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const u = { execute } as never;
  const controller = new UsersController(u as ListUsers, u as GetUser, u as CreateUser, u as UpdateUser, u as DisableUser, u as ResetUserPassword);
  const actor = owner();

  it('delegates every route to its use case', async () => {
    await controller.list(actor, { limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, { limit: 5 });
    await controller.get(actor, { id: ID });
    expect(execute).toHaveBeenLastCalledWith(actor, ID);
    await controller.create(actor, '10.0.0.1', { email: 'a@b.c', displayName: 'A' });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: '10.0.0.1' }, { email: 'a@b.c', displayName: 'A' });
    await controller.update(actor, null, { id: ID }, { displayName: 'A' });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID, { displayName: 'A' });
    await controller.disable(actor, null, { id: ID });
    await controller.resetPassword(actor, null, { id: ID });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: null }, ID);
  });

  it('maps domain errors to HTTP', async () => {
    execute.mockRejectedValueOnce(new ResourceConflict('Could not create the user'));
    await expect(controller.create(actor, null, { email: 'a@b.c', displayName: 'A' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RandomTemporaryPasswordGenerator', () => {
  it('generates distinct 24-character base64url passwords', () => {
    const generator = new RandomTemporaryPasswordGenerator();
    const [one, two] = [generator.generate(), generator.generate()];
    expect(one).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(one).not.toBe(two);
  });
});
