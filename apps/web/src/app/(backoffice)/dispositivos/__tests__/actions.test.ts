import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post }) }));

import { revokeDeviceAction } from '../actions';

const ID = '018f0000-0000-7000-8000-000000000001';
const form = (id: string) => {
  const f = new FormData();
  f.set('id', id);
  return f;
};

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
});

describe('revokeDeviceAction', () => {
  it('revokes and revalidates the list', async () => {
    post.mockResolvedValue({ data: {}, response: new Response(null, { status: 200 }) });
    expect(await revokeDeviceAction({}, form(ID))).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith('/devices/{id}/revoke', expect.objectContaining({ params: { path: { id: ID } } }));
    expect(revalidatePath).toHaveBeenCalledWith('/dispositivos');
  });

  it('rejects a malformed id without calling the API', async () => {
    expect((await revokeDeviceAction({}, form('zzz'))).error).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the API 403 (someone else\'s device) and 404 (other tenant) as Spanish messages', async () => {
    post.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 403 }) });
    expect((await revokeDeviceAction({}, form(ID))).error).toMatch(/No tienes permiso/);
    post.mockResolvedValueOnce({ error: {}, response: new Response(null, { status: 404 }) });
    expect((await revokeDeviceAction({}, form(ID))).error).toMatch(/no existe/);
  });
});
