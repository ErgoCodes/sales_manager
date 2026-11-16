import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSpy = vi.fn();
const post = vi.fn();
let access: string | undefined;
let refreshCookie: string | undefined;
const refreshSessionCookies = vi.fn();
const clientFactory = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => {
      const v = n === '__Host-access' ? access : n === '__Host-refresh' ? refreshCookie : undefined;
      return v ? { value: v } : undefined;
    },
    set: setSpy,
  }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/api/authenticated', () => ({
  createAuthenticatedClient: async (o: unknown) => {
    clientFactory(o);
    return { POST: post };
  },
}));
vi.mock('@/lib/session/server', async (orig) => ({
  ...(await orig<typeof import('@/lib/session/server')>()),
  refreshSessionCookies: () => refreshSessionCookies(),
}));
vi.mock('@/lib/env', async (orig) => {
  const real = await orig<typeof import('@/lib/env')>();
  return { ...real, parseServerEnv: () => ({ API_URL: 'http://api.test', APP_ORIGINS: 'https://app.test' }) };
});

import { POST } from '../route';

const req = (headers: Record<string, string>) => new NextRequest('https://app.test/logout', { method: 'POST', headers });

beforeEach(() => {
  setSpy.mockReset();
  post.mockReset();
  refreshSessionCookies.mockReset();
  clientFactory.mockReset();
  access = 'tok';
  refreshCookie = 'r';
});

describe('POST /logout', () => {
  it('rejects a cross-site request: 403, API untouched, cookies kept', async () => {
    const res = await POST(req({ origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
    expect(post).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('revokes the session, clears cookies and redirects to /login (303)', async () => {
    post.mockResolvedValue({ response: { status: 204 } });
    const res = await POST(req({ origin: 'https://app.test' }));
    expect(post).toHaveBeenCalledWith('/auth/logout', expect.anything());
    expect(setSpy.mock.calls.map((c) => c[0])).toEqual(['__Host-access', '__Host-refresh', '__Host-must_change_password']);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });

  it('clears the cookies even when the API call fails', async () => {
    post.mockRejectedValue(new Error('api down'));
    const res = await POST(req({ origin: 'https://app.test' }));
    expect(setSpy).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(303);
  });

  it('refresh cookie only (access expired): refreshes, then revokes with the new token, then clears cookies', async () => {
    access = undefined;
    refreshSessionCookies.mockResolvedValue('fresh-token');
    post.mockResolvedValue({ response: { status: 204 } });
    const order: string[] = [];
    refreshSessionCookies.mockImplementation(async () => (order.push('refresh'), 'fresh-token'));
    post.mockImplementation(async () => (order.push('logout'), { response: { status: 204 } }));
    setSpy.mockImplementation(() => order.push('clear'));
    const res = await POST(req({ origin: 'https://app.test' }));
    expect(order).toEqual(['refresh', 'logout', 'clear', 'clear', 'clear']);
    expect(clientFactory).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-token' }));
    expect(post).toHaveBeenCalledWith('/auth/logout', expect.anything());
    expect(res.status).toBe(303);
  });

  it('refresh cookie only and the refresh itself fails: no API logout, cookies still cleared', async () => {
    access = undefined;
    refreshSessionCookies.mockResolvedValue(null);
    const res = await POST(req({ origin: 'https://app.test' }));
    expect(post).not.toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(303);
  });

  it('refresh throws: cookies are still cleared', async () => {
    access = undefined;
    refreshSessionCookies.mockRejectedValue(new Error('boom'));
    const res = await POST(req({ origin: 'https://app.test' }));
    expect(setSpy).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(303);
  });

  it('an access cookie present does not trigger a refresh', async () => {
    post.mockResolvedValue({ response: { status: 204 } });
    await POST(req({ origin: 'https://app.test' }));
    expect(refreshSessionCookies).not.toHaveBeenCalled();
  });
});
