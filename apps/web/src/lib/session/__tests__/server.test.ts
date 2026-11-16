import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const setSpy = vi.fn();
const refresh = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (store.has(n) ? { value: store.get(n)! } : undefined), set: setSpy }),
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));
vi.mock('../refresh-api', () => ({ refreshSession: (...a: unknown[]) => refresh(...a) }));

import { getClientIp, getSession, refreshSessionCookies } from '../server';

beforeEach(() => {
  store.clear();
  setSpy.mockReset();
  refresh.mockReset();
});

describe('session server helpers', () => {
  it('reads the session and the client IP', async () => {
    store.set('__Host-access', 'a');
    expect((await getSession()).accessToken).toBe('a');
    expect(await getClientIp()).toBe('203.0.113.7');
  });

  it('refreshSessionCookies: no refresh cookie -> null without calling the API', async () => {
    expect(await refreshSessionCookies()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('writes the rotated cookies and returns the new access token', async () => {
    store.set('__Host-refresh', 'r1');
    refresh.mockResolvedValue({ kind: 'ok', accessToken: 'a2', expiresIn: 600, refreshToken: 'r2' });
    expect(await refreshSessionCookies()).toBe('a2');
    expect(refresh).toHaveBeenCalledWith('r1', '203.0.113.7');
    expect(setSpy.mock.calls.map((c) => c[0])).toEqual(['__Host-access', '__Host-refresh']);
  });

  it('a rejected refresh clears the session; an unavailable one keeps it', async () => {
    store.set('__Host-refresh', 'r1');
    refresh.mockResolvedValueOnce({ kind: 'rejected' });
    expect(await refreshSessionCookies()).toBeNull();
    expect(setSpy.mock.calls.every((c) => c[2].maxAge === 0)).toBe(true);
    expect(setSpy).toHaveBeenCalledTimes(3);
    setSpy.mockReset();
    refresh.mockResolvedValueOnce({ kind: 'unavailable' });
    expect(await refreshSessionCookies()).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
