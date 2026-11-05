import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { InvalidScope } from '../../../iam/domain/errors';
import type { ReplaceAssignments } from '../../application/replace-assignments.use-case';
import { AssignmentsController } from '../assignments.controller';

const ID = '0190a000-0000-7000-8000-000000000002';

describe('AssignmentsController', () => {
  it('delegates to the use case and maps domain errors', async () => {
    const execute = vi.fn(async (..._args: unknown[]) => 'ok');
    const controller = new AssignmentsController({ execute } as unknown as ReplaceAssignments);
    const actor = owner();
    expect(await controller.replace(actor, '10.0.0.1', { id: ID }, { assignments: [] })).toBe('ok');
    expect(execute).toHaveBeenCalledWith({ actor, ip: '10.0.0.1' }, ID, { assignments: [] });
    execute.mockRejectedValueOnce(new InvalidScope('empty_locations'));
    const error = await controller.replace(actor, null, { id: ID }, { assignments: [] }).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(422);
  });
});
