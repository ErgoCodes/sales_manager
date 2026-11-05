import { describe, expect, it } from 'vitest';

import { encodeCursor } from '../../../../iam/infrastructure/pagination';
import { fakeTx, ID, NOW_TEXT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { AuditEventsRepository } from '../audit-events.repository';

const AT = '2026-11-05T12:00:00.123456Z';
const row = { id: ID, actorUserId: null, type: 'login_failed', targetType: 'user', targetId: ID, metadata: {}, ip: '10.0.0.1', createdAt: NOW_TEXT, cursorAt: AT };

describe('AuditEventsRepository', () => {
  it('pages newest first with a (created_at, id) cursor that keeps microseconds', async () => {
    const { tx, queries } = fakeTx([row, row], [row]);
    const repo = new AuditEventsRepository(tx);
    const { cursorAt: _cursorAt, ...event } = row;
    const page = await repo.list({ limit: 1 });
    expect(page).toEqual({ items: [{ ...event, createdAt: new Date(NOW_TEXT) }], nextCursor: encodeCursor([AT, ID]) });
    expect(queries[0]!.params).toEqual([null, null, null, 2]);

    await repo.list({ limit: 1, cursor: page.nextCursor! });
    expect(queries[1]!.params).toEqual([AT, AT, ID, 2]);
    expect(queries[1]!.sql).toMatch(/order by created_at desc, id desc/);
  });
});
