import { describe, expect, it } from 'vitest';

import { encodeCursor } from '../../../../iam/infrastructure/pagination';
import { fakeTx, ID, NOW, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { UserAdminRepositoryImpl } from '../user-admin.repository';

const row = { id: ID, email: 'a@b.c', displayName: 'A', status: 'active', mustChangePassword: true, createdAt: NOW_TEXT };
const record = { ...row, createdAt: new Date(NOW_TEXT) };

describe('UserAdminRepositoryImpl', () => {
  it('lists pages, finds, and never selects the password hash', async () => {
    const { tx, queries } = fakeTx([row], [row], []);
    const repo = new UserAdminRepositoryImpl(tx, TENANT);
    expect(await repo.list({ limit: 5, cursor: encodeCursor([ID]) })).toEqual({ items: [record], nextCursor: null });
    expect(queries[0]!.params).toEqual([ID, ID, 6]);
    expect(await repo.findById(ID)).toEqual(record);
    expect(await repo.findById(ID)).toBeNull();
    for (const query of queries) expect(query.sql).not.toMatch(/password_hash/);
  });

  it('creates with a temporary password, or returns null on an email conflict', async () => {
    const { tx, queries } = fakeTx([row], []);
    const repo = new UserAdminRepositoryImpl(tx, TENANT);
    const user = { email: 'a@b.c', displayName: 'A', passwordHash: 'h', passwordExpiresAt: NOW, now: NOW };
    expect(await repo.create(user)).toEqual(record);
    expect(queries[0]!.params.slice(1)).toEqual([TENANT, 'a@b.c', 'A', 'h', NOW, NOW]);
    expect(queries[0]!.sql).toMatch(/on conflict \(email\) do nothing/);
    expect(await repo.create(user)).toBeNull();
  });

  it('renames, disables and sets a temporary password', async () => {
    const { tx, queries } = fakeTx([row], [], [], []);
    const repo = new UserAdminRepositoryImpl(tx, TENANT);
    expect(await repo.updateDisplayName(ID, 'B')).toEqual(record);
    expect(await repo.disable(ID)).toBeNull();
    expect(queries[1]!.sql).toMatch(/set status = 'disabled'/);
    await repo.setTemporaryPassword(ID, 'h2', NOW);
    expect(queries[2]!.params).toEqual(['h2', NOW, ID]);
    expect(queries[2]!.sql).toMatch(/must_change_password = true/);
  });
});
