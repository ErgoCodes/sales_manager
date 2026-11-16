import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const patch = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post, PATCH: patch }) }));

import { archiveLocationAction, createLocationAction, updateLocationAction } from '../actions';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const ok = (status = 200, data: unknown = {}) => ({ data, response: new Response(null, { status }) });
const fail = (status: number, code?: string) => ({ error: { error: { code } }, response: new Response(null, { status }) });
const ID = '018f0000-0000-7000-8000-000000000001';

beforeEach(() => {
  post.mockReset();
  patch.mockReset();
  revalidatePath.mockReset();
});

describe('createLocationAction', () => {
  it('validates with the contract schema before calling the API', async () => {
    const state = await createLocationAction({}, form({ name: 'Centro', code: 'bad code!' }));
    expect(state.error).toMatch(/código/);
    expect(post).not.toHaveBeenCalled();
  });

  it('creates, revalidates the list and reports done', async () => {
    post.mockResolvedValue(ok(201));
    const state = await createLocationAction({}, form({ name: ' Centro ', code: 'CEN-1' }));
    expect(state).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith('/locations', expect.objectContaining({ body: { name: 'Centro', code: 'CEN-1' } }));
    expect(revalidatePath).toHaveBeenCalledWith('/puntos-de-venta');
  });

  it('shows the 409 (duplicate code) as a Spanish message and does not revalidate', async () => {
    post.mockResolvedValue(fail(409, 'conflict'));
    const state = await createLocationAction({}, form({ name: 'Centro', code: 'CEN-1' }));
    expect(state.error).toMatch(/Ya existe/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('shows the 403 from the API even when the UI offered the action', async () => {
    post.mockResolvedValue(fail(403));
    expect((await createLocationAction({}, form({ name: 'Centro', code: 'CEN-1' }))).error).toMatch(/No tienes permiso/);
  });
});

describe('updateLocationAction', () => {
  it('patches only the given id', async () => {
    patch.mockResolvedValue(ok());
    const state = await updateLocationAction({}, form({ id: ID, name: 'Nuevo', code: 'N-1' }));
    expect(state.done).toBe(true);
    expect(patch).toHaveBeenCalledWith('/locations/{id}', expect.objectContaining({ params: { path: { id: ID } }, body: { name: 'Nuevo', code: 'N-1' } }));
  });

  it('rejects a malformed id without calling the API', async () => {
    expect((await updateLocationAction({}, form({ id: 'nope', name: 'x', code: 'y' }))).error).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('archiveLocationAction', () => {
  it('archives through POST and revalidates', async () => {
    post.mockResolvedValue(ok());
    expect(await archiveLocationAction({}, form({ id: ID }))).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith('/locations/{id}/archive', expect.objectContaining({ params: { path: { id: ID } } }));
  });

  it('renders a 404 as a clear message', async () => {
    post.mockResolvedValue(fail(404));
    expect((await archiveLocationAction({}, form({ id: ID }))).error).toMatch(/no existe/);
  });
});
