import { describe, expect, it } from 'vitest';

import { encodeCursor } from '../../../../iam/infrastructure/pagination';
import { fakeTx, ID, NOW, NOW_TEXT, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { LocationsRepository } from '../locations.repository';

const row = { id: ID, name: 'Norte', code: 'N1', archivedAt: null, createdAt: NOW_TEXT };
const record = { id: ID, name: 'Norte', code: 'N1', archivedAt: null, createdAt: new Date(NOW_TEXT) };

describe('LocationsRepository', () => {
  it('lists a page after the cursor, optionally restricted to some ids', async () => {
    const { tx, queries } = fakeTx([row, { ...row, id: 'next' }], []);
    const repo = new LocationsRepository(tx, TENANT);
    const page = await repo.list({ limit: 1 });
    expect(page).toEqual({ items: [record], nextCursor: encodeCursor([ID]) });
    expect(queries[0]!.params).toEqual([null, null, true, [], 2]);

    await repo.list({ limit: 10, cursor: encodeCursor([ID]), onlyIds: ['x'] });
    expect(queries[1]!.params).toEqual([ID, ID, false, ['x'], 11]);
  });

  it('creates with a fresh id, the tenant and the date', async () => {
    const { tx, queries } = fakeTx([row]);
    expect(await new LocationsRepository(tx, TENANT).create({ name: 'Norte', code: 'N1', now: NOW })).toEqual(record);
    expect(queries[0]!.params.slice(1)).toEqual([TENANT, 'Norte', 'N1', NOW]);
  });

  it('updates and archives (keeping the first archive date), null when missing', async () => {
    const archived = { ...row, archivedAt: NOW_TEXT };
    const { tx, queries } = fakeTx([row], [], [archived], []);
    const repo = new LocationsRepository(tx, TENANT);
    expect(await repo.update(ID, { name: 'Norte' })).toEqual(record);
    expect(queries[0]!.params).toEqual(['Norte', null, ID]);
    expect(await repo.update(ID, { code: 'N2' })).toBeNull();
    expect(await repo.archive(ID, NOW)).toEqual({ ...record, archivedAt: new Date(NOW_TEXT) });
    expect(queries[2]!.sql).toMatch(/archived_at = coalesce\(archived_at, \$1\)/);
    expect(await repo.archive(ID, NOW)).toBeNull();
  });

  it('finds the active ids among some, without a query for none', async () => {
    const { tx, queries } = fakeTx([{ id: ID }]);
    const repo = new LocationsRepository(tx, TENANT);
    expect(await repo.findActiveIds([])).toEqual([]);
    expect(await repo.findActiveIds([ID, 'gone'])).toEqual([ID]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toMatch(/archived_at is null$/);
  });
});
