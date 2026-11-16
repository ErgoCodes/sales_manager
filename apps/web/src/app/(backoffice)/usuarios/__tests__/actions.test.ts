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

import { createUserAction, disableUserAction, resetPasswordAction } from '../actions';

const ID = '018f0000-0000-7000-8000-000000000001';
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const fail = (status: number, code?: string) => ({ error: { error: { code } }, response: new Response(null, { status }) });
const created = { user: { id: ID }, temporaryPassword: 'tmp-Secret-123456', temporaryPasswordExpiresAt: '2026-11-20T10:00:00.000Z' };

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('createUserAction', () => {
  it('validates email and name with the contract before calling the API', async () => {
    expect((await createUserAction({}, form({ email: 'not-an-email', displayName: 'Ana' }))).error).toMatch(/correo/);
    expect(post).not.toHaveBeenCalled();
  });

  it('returns the temporary password in the action result only, never logs it', async () => {
    post.mockResolvedValue({ data: created, response: new Response(null, { status: 201 }) });
    const state = await createUserAction({}, form({ email: 'ana@example.com', displayName: 'Ana' }));
    expect(state).toEqual({ done: true, temporaryPassword: { value: 'tmp-Secret-123456', expiresAt: created.temporaryPasswordExpiresAt, email: 'ana@example.com' } });
    expect(revalidatePath).toHaveBeenCalledWith('/usuarios');
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('tmp-Secret');
  });

  it('shows the duplicate email 409 as a clear message', async () => {
    post.mockResolvedValue(fail(409, 'conflict'));
    expect((await createUserAction({}, form({ email: 'ana@example.com', displayName: 'Ana' }))).error).toMatch(/Ya existe/);
  });
});

describe('resetPasswordAction', () => {
  it('returns the new temporary password once', async () => {
    post.mockResolvedValue({ data: { temporaryPassword: 'tmp-Other-123456', temporaryPasswordExpiresAt: created.temporaryPasswordExpiresAt }, response: new Response(null, { status: 200 }) });
    const state = await resetPasswordAction({}, form({ id: ID, email: 'ana@example.com' }));
    expect(state.temporaryPassword?.value).toBe('tmp-Other-123456');
    expect(post).toHaveBeenCalledWith('/users/{id}/reset-password', expect.objectContaining({ params: { path: { id: ID } } }));
  });

  it('shows the last-owner 409', async () => {
    post.mockResolvedValue(fail(409, 'owner_invariant_violation'));
    expect((await resetPasswordAction({}, form({ id: ID }))).error).toMatch(/propietario/);
  });
});

describe('disableUserAction', () => {
  it('disables and revalidates', async () => {
    post.mockResolvedValue({ data: {}, response: new Response(null, { status: 200 }) });
    expect(await disableUserAction({}, form({ id: ID }))).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith('/users/{id}/disable', expect.objectContaining({ params: { path: { id: ID } } }));
  });

  it('renders a 403 (e.g. a Manager trying to disable an Owner)', async () => {
    post.mockResolvedValue(fail(403, 'forbidden_escalation'));
    expect((await disableUserAction({}, form({ id: ID }))).error).toMatch(/propietario/);
  });
});
