import { describe, expect, it, vi } from 'vitest';

import { AuditEventsController } from '../../../audit/http/audit-events.controller';
import type { ListAuditEvents } from '../../../audit/application/list-audit-events.use-case';
import { owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import type { ListDevices, RevokeDevice } from '../../application/devices.use-cases';
import { DevicesController } from '../devices.controller';

const ID = '0190a000-0000-7000-8000-000000000002';

describe('DevicesController and AuditEventsController', () => {
  const execute = vi.fn(async (..._args: unknown[]) => 'ok');
  const u = { execute } as never;
  const actor = owner();

  it('delegate to their use cases', async () => {
    const devices = new DevicesController(u as ListDevices, u as RevokeDevice);
    await devices.list(actor, { limit: 5, userId: ID });
    expect(execute).toHaveBeenLastCalledWith(actor, { limit: 5, userId: ID });
    await devices.revoke(actor, '10.0.0.1', { id: ID });
    expect(execute).toHaveBeenLastCalledWith({ actor, ip: '10.0.0.1' }, ID);
    await new AuditEventsController(u as ListAuditEvents).list(actor, { limit: 5 });
    expect(execute).toHaveBeenLastCalledWith(actor, { limit: 5 });
  });

  it('propagates domain errors', async () => {
    execute.mockRejectedValueOnce(new PermissionDenied('devices:manage'));
    await expect(new DevicesController(u as ListDevices, u as RevokeDevice).revoke(actor, null, { id: ID })).rejects.toBeInstanceOf(PermissionDenied);
  });
});
