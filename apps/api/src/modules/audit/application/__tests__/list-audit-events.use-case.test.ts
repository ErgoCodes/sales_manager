import { describe, expect, it } from 'vitest';

import { actorWith, fakeUow, NOW, owner } from '../../../iam/application/__tests__/admin-fakes';
import { PermissionDenied } from '../../../iam/domain/errors';
import { ListAuditEvents } from '../list-audit-events.use-case';

describe('ListAuditEvents', () => {
  it('needs audit:view and returns ISO dates', async () => {
    const { uow, scope, runs } = fakeUow();
    const event = { id: 'e', actorUserId: null, type: 'login_failed' as const, targetType: null, targetId: null, metadata: {}, ip: null, createdAt: NOW };
    scope.auditEvents.list.mockResolvedValue({ items: [event], nextCursor: 'n' });
    expect(await new ListAuditEvents(uow).execute(owner(), { limit: 2 })).toEqual({ items: [{ ...event, createdAt: '2026-11-05T12:00:00.000Z' }], nextCursor: 'n' });
    await expect(new ListAuditEvents(uow).execute(actorWith([]), { limit: 2 })).rejects.toThrow(PermissionDenied);
    expect(runs).toHaveLength(1);
  });
});
