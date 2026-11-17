import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const createClient = vi.fn();
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: (opts: unknown) => createClient(opts) }));

import { callApi } from '../admin';

const raw = (status: number, body?: unknown) => ({
  data: status < 400 ? body : undefined,
  error: status >= 400 ? body : undefined,
  response: new Response(null, { status }),
});

beforeEach(() => {
  createClient.mockReset();
  createClient.mockResolvedValue({});
});

describe('callApi', () => {
  it('returns the data on success and forwards canRefresh to the client', async () => {
    const result = await callApi(async () => raw(200, { id: 'x' }), { canRefresh: true });
    expect(result).toEqual({ ok: true, data: { id: 'x' } });
    expect(createClient).toHaveBeenCalledWith({ canRefresh: true });
  });

  it('treats 204 (no body) as success', async () => {
    expect(await callApi(async () => raw(204), { canRefresh: true })).toEqual({ ok: true, data: undefined });
  });

  it.each([
    [403, undefined, /No tienes permiso/],
    [404, undefined, /no existe/],
    [409, { error: { code: 'owner_invariant_violation' } }, /propietario/],
    [422, { error: { code: 'validation_error' } }, /no son válidos/],
    [500, undefined, /no está disponible/],
  ])('maps %s to a Spanish message', async (status, body, message) => {
    const result = await callApi(async () => raw(status, body), { canRefresh: false });
    expect(result).toMatchObject({ ok: false, status });
    expect(result.ok ? '' : result.message).toMatch(message);
  });

  it('turns a network failure into a controlled error', async () => {
    const result = await callApi(
      async () => {
        throw new TypeError('fetch failed');
      },
      { canRefresh: false },
    );
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(result.ok ? '' : result.message).toMatch(/No pudimos conectar/);
  });

  it('redirects to /login on 401 (session over)', async () => {
    await expect(callApi(async () => raw(401), { canRefresh: true })).rejects.toThrow('REDIRECT:/login');
  });
});
