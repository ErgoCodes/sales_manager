import { describe, expect, it } from 'vitest';

import { fakeTx, ID, NOW, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { RolesRepository } from '../roles.repository';

// Permissions come back in any order (json_agg); the record keeps catalog order.
const row = { id: ID, key: null, name: 'Caja', isSystem: false, createdAt: NOW_TEXT, permissions: ['cash:close', 'sales:create'] };
const record = { ...row, createdAt: new Date(NOW_TEXT), permissions: ['sales:create', 'cash:close'] };

describe('RolesRepository', () => {
  it('lists, finds one and finds several', async () => {
    const { tx, queries } = fakeTx([row], [row], [], [row]);
    const repo = new RolesRepository(tx, TENANT);
    expect(await repo.list({ limit: 5 })).toEqual({ items: [record], nextCursor: null });
    expect(queries[0]!.params).toEqual([null, null, 6]);
    expect(await repo.findById(ID)).toEqual(record);
    expect(await repo.findById(ID)).toBeNull();
    expect(await repo.findByIds([])).toEqual([]);
    expect(await repo.findByIds([ID])).toEqual([record]);
    expect(queries[3]!.params).toEqual([[ID]]);
  });

  it('creates a custom role with its permissions', async () => {
    const { tx, queries } = fakeTx([], [], [row]);
    const repo = new RolesRepository(tx, TENANT);
    expect(await repo.create({ name: 'Caja', permissions: ['sales:create'], now: NOW })).toEqual(record);
    expect(queries[0]!.params.slice(1)).toEqual([TENANT, 'Caja', NOW]);
    expect(queries[1]!.params.slice(1)).toEqual([TENANT, ['sales:create']]);
  });

  it('updates the name and/or replaces the permissions, and deletes', async () => {
    const { tx, queries } = fakeTx([], [], [], [row], [row], [], [row], []);
    const repo = new RolesRepository(tx, TENANT);
    await repo.update(ID, { name: 'X', permissions: ['sales:create'] });
    expect(queries.map((q) => q.sql.split(' ')[0])).toEqual(['update', 'delete', 'insert', 'select']);
    await repo.update(ID, { name: 'Y' });
    expect(queries).toHaveLength(6);
    await repo.update(ID, { permissions: [] });
    expect(queries[6]!.sql).toMatch(/^delete from role_permissions/);
    expect(queries).toHaveLength(8);
    await repo.delete(ID);
    expect(queries[8]!.sql).toBe('delete from roles where id = $1');
  });
});
