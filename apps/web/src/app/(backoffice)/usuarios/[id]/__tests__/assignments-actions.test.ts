import { beforeEach, describe, expect, it, vi } from 'vitest';

const put = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ PUT: put }) }));

import { replaceAssignmentsAction } from '../actions';

const U = '018f0000-0000-7000-8000-000000000001';
const R = '018f0000-0000-7000-8000-0000000000a1';
const L = '018f0000-0000-7000-8000-0000000000b1';
const form = (payload: unknown) => {
  const f = new FormData();
  f.set('id', U);
  f.set('payload', JSON.stringify(payload));
  return f;
};
const fail = (status: number, code?: string) => ({ error: { error: { code } }, response: new Response(null, { status }) });

beforeEach(() => {
  put.mockReset();
  revalidatePath.mockReset();
});

describe('replaceAssignmentsAction', () => {
  it('sends the validated assignments atomically', async () => {
    put.mockResolvedValue({ data: { assignments: [] }, response: new Response(null, { status: 200 }) });
    const assignments = [{ roleId: R, scope: { type: 'locations', locationIds: [L] } }];
    const state = await replaceAssignmentsAction({}, form({ assignments }));
    expect(state).toEqual({ done: true });
    expect(put).toHaveBeenCalledWith('/users/{id}/assignments', expect.objectContaining({ params: { path: { id: U } }, body: { assignments } }));
    expect(revalidatePath).toHaveBeenCalledWith(`/usuarios/${U}`);
  });

  it('rejects a malformed payload with the contract schema (no API call)', async () => {
    expect((await replaceAssignmentsAction({}, form({ assignments: [{ roleId: 'x' }] }))).error).toBeTruthy();
    const bad = new FormData();
    bad.set('id', U);
    bad.set('payload', '{not json');
    expect((await replaceAssignmentsAction({}, bad)).error).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'self_modification', /propias asignaciones/],
    [409, 'owner_invariant_violation', /propietario/],
    [422, 'invalid_scope', /alcance/],
    [404, undefined, /no existe/],
  ])('renders API %s as a clear message', async (status, code, message) => {
    put.mockResolvedValue(fail(status, code));
    expect((await replaceAssignmentsAction({}, form({ assignments: [] }))).error).toMatch(message);
  });
});
