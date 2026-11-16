import { describe, expect, it } from 'vitest';
import { buildAssignments, rowsFromAssignments, type AssignmentRow } from '../assignments';

const R1 = '018f0000-0000-7000-8000-0000000000a1';
const R2 = '018f0000-0000-7000-8000-0000000000a2';
const L1 = '018f0000-0000-7000-8000-0000000000b1';
const L2 = '018f0000-0000-7000-8000-0000000000b2';
const roles = [
  { id: R1, name: 'Cajero', permissions: ['sales:create'] },
  { id: R2, name: 'Gerente', permissions: ['users:manage', 'sales:create'] },
] as const;
const row = (over: Partial<AssignmentRow>): AssignmentRow => ({ key: Math.random().toString(), roleId: R1, scope: 'tenant', locationIds: [], ...over });

describe('buildAssignments', () => {
  it('builds tenant and location scopes in the contract shape', () => {
    const result = buildAssignments([row({ roleId: R1, scope: 'locations', locationIds: [L1, L2] }), row({ roleId: R2 })], roles);
    expect(result).toEqual({
      ok: true,
      assignments: [
        { roleId: R1, scope: { type: 'locations', locationIds: [L1, L2] } },
        { roleId: R2, scope: { type: 'tenant' } },
      ],
    });
  });

  it('accepts an empty list (removes every assignment)', () => {
    expect(buildAssignments([], roles)).toEqual({ ok: true, assignments: [] });
  });

  it('requires a role in every row', () => {
    expect(buildAssignments([row({ roleId: '' })], roles)).toMatchObject({ ok: false, error: expect.stringMatching(/rol/) });
  });

  it('requires at least one location for a locations scope', () => {
    expect(buildAssignments([row({ scope: 'locations', locationIds: [] })], roles)).toMatchObject({ ok: false, error: expect.stringMatching(/punto de venta/) });
  });

  it('rejects an administrative role limited to locations (the API would answer 422)', () => {
    const result = buildAssignments([row({ roleId: R2, scope: 'locations', locationIds: [L1] })], roles);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Gerente.*todo el negocio/) });
  });

  it('rejects duplicated assignments', () => {
    const result = buildAssignments([row({ roleId: R1 }), row({ roleId: R1 })], roles);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/repetid/) });
  });

  it('drops location ids when the scope is tenant', () => {
    const result = buildAssignments([row({ roleId: R1, scope: 'tenant', locationIds: [L1] })], roles);
    expect(result).toMatchObject({ ok: true, assignments: [{ roleId: R1, scope: { type: 'tenant' } }] });
  });
});

describe('rowsFromAssignments', () => {
  it('maps API assignments to editable rows', () => {
    const rows = rowsFromAssignments([
      { id: 'x', roleId: R1, scope: { type: 'tenant' } },
      { id: 'y', roleId: R2, scope: { type: 'locations', locationIds: [L1] } },
    ]);
    expect(rows.map(({ roleId, scope, locationIds }) => ({ roleId, scope, locationIds }))).toEqual([
      { roleId: R1, scope: 'tenant', locationIds: [] },
      { roleId: R2, scope: 'locations', locationIds: [L1] },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});
