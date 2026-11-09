import { describe, expect, it } from 'vitest';

import { ForbiddenEscalation, OwnerInvariantViolation } from '../../domain/errors';
import { iso, isoOrNull, runAdmin } from '../admin-support';
import { fakeUow, NOW, owner, TARGET_ID, TENANT } from './admin-fakes';

describe('runAdmin', () => {
  const request = { actor: owner(), ip: '203.0.113.9' };
  const target = { type: 'user', id: TARGET_ID };

  it('runs the work in the actor tenant and returns its result', async () => {
    const { uow, runs } = fakeUow();
    expect(await runAdmin(uow, request, 'op', target, async () => 42)).toBe(42);
    expect(runs).toEqual([TENANT]);
  });

  it('audits a denied escalation with its reason in a second transaction, then rethrows', async () => {
    const { uow, scope, runs } = fakeUow();
    const error = new ForbiddenEscalation('owner_only');
    await expect(runAdmin(uow, request, 'disable_user', target, async () => Promise.reject(error))).rejects.toBe(error);
    expect(runs).toEqual([TENANT, TENANT]);
    expect(scope.audit.record).toHaveBeenCalledWith({
      type: 'escalation_denied',
      actorUserId: request.actor.userId,
      targetType: 'user',
      targetId: TARGET_ID,
      metadata: { operation: 'disable_user', reason: 'owner_only' },
      ip: '203.0.113.9',
    });
  });

  it('rethrows any other error without auditing', async () => {
    const { uow, scope } = fakeUow();
    await expect(runAdmin(uow, request, 'op', target, async () => Promise.reject(new OwnerInvariantViolation()))).rejects.toThrow(OwnerInvariantViolation);
    expect(scope.audit.record).not.toHaveBeenCalled();
  });
});

describe('date helpers', () => {
  it('formats ISO dates', () => {
    expect(iso(NOW)).toBe('2026-11-05T12:00:00.000Z');
    expect(isoOrNull(NOW)).toBe('2026-11-05T12:00:00.000Z');
    expect(isoOrNull(null)).toBeNull();
  });
});
