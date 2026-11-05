import { describe, expect, it } from 'vitest';

import { fakeTx, ID, NOW, TENANT } from '../../../../iam/infrastructure/__tests__/fake-tx';
import { AssignmentsRepository } from '../assignments.repository';

const LOC = '0190a000-0000-7000-8000-0000000000c1';

describe('AssignmentsRepository', () => {
  it("lists a user's assignments, dropping permissions outside the catalog", async () => {
    const row = { id: 'a', roleId: 'r', roleKey: null, isSystem: false, scope: 'locations', permissions: ['sales:create', 'nope'], locationIds: [LOC] };
    const { tx, queries } = fakeTx([row]);
    expect(await new AssignmentsRepository(tx, TENANT).listByUser(ID)).toEqual([{ ...row, permissions: ['sales:create'] }]);
    expect(queries[0]!.params).toEqual([ID]);
    expect(queries[0]!.sql).toMatch(/loc\.archived_at is null/);
  });

  it('replaces: deletes all, then inserts each assignment and its locations', async () => {
    const { tx, queries } = fakeTx();
    const saved = await new AssignmentsRepository(tx, TENANT).replace(
      ID,
      [
        { roleId: 'r1', scope: { type: 'tenant' } },
        { roleId: 'r2', scope: { type: 'locations', locationIds: [LOC] } },
      ],
      NOW,
    );
    expect(saved).toEqual([
      { id: expect.any(String), roleId: 'r1', scope: { type: 'tenant' } },
      { id: expect.any(String), roleId: 'r2', scope: { type: 'locations', locationIds: [LOC] } },
    ]);
    expect(queries.map((q) => q.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'delete from role_assignments',
      'insert into role_assignments',
      'insert into role_assignments',
      'insert into role_assignment_locations',
    ]);
    expect(queries[1]!.params).toEqual([saved[0]!.id, TENANT, ID, 'r1', 'tenant', NOW]);
    expect(queries[3]!.params).toEqual([saved[1]!.id, TENANT, [LOC]]);
  });

  it('reads the Owner candidates as Owner assignments with their status', async () => {
    const { tx } = fakeTx([{ roleId: 'r', status: 'disabled' }]);
    const [candidate] = await new AssignmentsRepository(tx, TENANT).ownerCandidates();
    expect(candidate).toMatchObject({ status: 'disabled', assignments: [{ role: { id: 'r', key: 'owner', isSystem: true }, scope: { type: 'tenant' } }] });
  });

  it('counts the assignments of a role and tells whether any is locations-scoped', async () => {
    const { tx } = fakeTx([{ n: 3 }], [], [{ found: true }], []);
    const repo = new AssignmentsRepository(tx, TENANT);
    expect(await repo.countByRole('r')).toBe(3);
    expect(await repo.countByRole('r')).toBe(0);
    expect(await repo.hasLocationScopedByRole('r')).toBe(true);
    expect(await repo.hasLocationScopedByRole('r')).toBe(false);
  });
});
