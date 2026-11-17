import { describe, expect, it } from 'vitest';
import { parseRoleForm, togglePermission } from '../roles-form';

const form = (name: string, permissions: string[]) => {
  const f = new FormData();
  f.set('name', name);
  for (const p of permissions) f.append('permissions', p);
  return f;
};

describe('parseRoleForm', () => {
  it('parses name and permissions with the contract schema', () => {
    expect(parseRoleForm(form(' Supervisor ', ['sales:create', 'reports:view']))).toEqual({ ok: true, body: { name: 'Supervisor', permissions: ['sales:create', 'reports:view'] } });
  });

  it('requires a name and at least one permission', () => {
    expect(parseRoleForm(form('', ['sales:create']))).toMatchObject({ ok: false, error: expect.stringMatching(/nombre/) });
    expect(parseRoleForm(form('X', []))).toMatchObject({ ok: false, error: expect.stringMatching(/al menos un permiso/) });
  });

  it('rejects permissions outside the catalog', () => {
    expect(parseRoleForm(form('X', ['root:all']))).toMatchObject({ ok: false });
  });

  it('collapses duplicates instead of failing', () => {
    expect(parseRoleForm(form('X', ['sales:create', 'sales:create']))).toMatchObject({ ok: true, body: { permissions: ['sales:create'] } });
  });
});

describe('togglePermission', () => {
  it('adds and removes without mutating the input', () => {
    const base = ['sales:create'] as const;
    expect(togglePermission(base, 'reports:view', true)).toEqual(['sales:create', 'reports:view']);
    expect(togglePermission(base, 'sales:create', false)).toEqual([]);
    expect(base).toEqual(['sales:create']);
  });
});
