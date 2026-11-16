import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSpy = vi.fn();
const post = vi.fn();
let access: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === '__Host-access' && access ? { value: access } : undefined), set: setSpy }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post }) }));
vi.mock('@/lib/env', async (orig) => {
  const real = await orig<typeof import('@/lib/env')>();
  return { ...real, parseServerEnv: () => ({ API_URL: 'http://api.test', APP_ORIGINS: 'https://app.test' }) };
});

import { POST } from '../route';

const req = (headers: Record<string, string>) => new NextRequest('https://app.test/logout', { method: 'POST', headers });

beforeEach(() => {
  setSpy.mockReset();
  post.mockReset();
  access = 'tok';
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
});
