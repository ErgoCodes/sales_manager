import { describe, expect, it } from 'vitest';

import { encodeCursor } from '../../../../iam/infrastructure/pagination';
import { fakeTx, ID, NOW, NOW_TEXT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { DeviceAdminRepositoryImpl } from '../device-admin.repository';

const row = { id: ID, userId: 'u', label: 'Chrome', platform: 'web', createdAt: NOW_TEXT, lastSeenAt: null, revokedAt: NOW_TEXT };
const record = { ...row, createdAt: new Date(NOW_TEXT), revokedAt: new Date(NOW_TEXT) };

describe('DeviceAdminRepositoryImpl', () => {
  it("lists a user's devices newest first, finds and revokes once", async () => {
    const { tx, queries } = fakeTx([row, row], [row], [], [row], []);
    const repo = new DeviceAdminRepositoryImpl(tx);
    expect(await repo.listByUser('u', { limit: 1, cursor: encodeCursor([ID]) })).toEqual({ items: [record], nextCursor: encodeCursor([ID]) });
    expect(queries[0]!.params).toEqual(['u', ID, ID, 2]);
    expect(queries[0]!.sql).toMatch(/order by id desc/);
    expect(await repo.findById(ID)).toEqual(record);
    expect(await repo.findById(ID)).toBeNull();
    expect(await repo.revoke(ID, NOW)).toEqual(record);
    expect(queries[3]!.sql).toMatch(/revoked_at = coalesce\(revoked_at, \$1\)/);
    expect(await repo.revoke(ID, NOW)).toBeNull();
  });
});
