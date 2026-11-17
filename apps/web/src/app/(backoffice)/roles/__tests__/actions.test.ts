import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post, PATCH: patch, DELETE: del }) }));

import { createRoleAction, deleteRoleAction, updateRoleAction } from '../actions';

const ID = '018f0000-0000-7000-8000-000000000001';
const form = (fields: Record<string, string>, permissions: string[] = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const p of permissions) f.append('permissions', p);
  return f;
};
const ok = (status = 200) => ({ data: {}, response: new Response(null, { status }) });
const fail = (status: number, code?: string) => ({ error: { error: { code } }, response: new Response(null, { status }) });

beforeEach(() => {
  for (const m of [post, patch, del, revalidatePath]) m.mockReset();
});

describe('role actions', () => {
  it('creates a custom role with the selected permissions', async () => {
    post.mockResolvedValue(ok(201));
    const state = await createRoleAction({}, form({ name: 'Supervisor' }, ['sales:create', 'reports:view']));
    expect(state).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith('/roles', expect.objectContaining({ body: { name: 'Supervisor', permissions: ['sales:create', 'reports:view'] } }));
    expect(revalidatePath).toHaveBeenCalledWith('/roles');
  });

  it('validates locally (no permission chosen) without calling the API', async () => {
    expect((await createRoleAction({}, form({ name: 'X' }))).error).toMatch(/al menos un permiso/);
    expect(post).not.toHaveBeenCalled();
  });

  it('renders the escalation 403 as a clear message', async () => {
    post.mockResolvedValue(fail(403, 'forbidden_escalation'));
    expect((await createRoleAction({}, form({ name: 'X' }, ['users:manage']))).error).toMatch(/permisos que tú no tienes/);
  });

  it('updates by id', async () => {
    patch.mockResolvedValue(ok());
    const state = await updateRoleAction({}, form({ id: ID, name: 'Nuevo' }, ['sales:create']));
    expect(state.done).toBe(true);
    expect(patch).toHaveBeenCalledWith('/roles/{id}', expect.objectContaining({ params: { path: { id: ID } } }));
  });

  it('shows 409 role_in_use when deleting a role that is assigned', async () => {
    del.mockResolvedValue(fail(409, 'role_in_use'));
    expect((await deleteRoleAction({}, form({ id: ID }))).error).toMatch(/en uso/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('deletes through DELETE and treats 204 as success', async () => {
    del.mockResolvedValue({ response: new Response(null, { status: 204 }) });
    expect(await deleteRoleAction({}, form({ id: ID }))).toEqual({ done: true });
  });
});
