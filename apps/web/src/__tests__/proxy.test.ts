import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshSession = vi.fn();
vi.mock('@/lib/session/refresh-api', () => ({ refreshSession: (...a: unknown[]) => refreshSession(...a) }));

import { proxy } from '../proxy';

const call = (path: string, cookies: Record<string, string> = {}, method = 'GET') =>
  proxy(
    new NextRequest(`https://app.test${path}`, {
      method,
      headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': '203.0.113.7' },
    }),
  );
const location = (r: Response) => new URL(r.headers.get('location')!).pathname;
const setCookie = (r: Response) => r.headers.getSetCookie();

beforeEach(() => refreshSession.mockReset());

describe('proxy', () => {
  it('sets a CSP with a fresh nonce on every response', async () => {
    const a = await call('/login');
    const b = await call('/login');
    const nonce = (r: Response) => /nonce-([^']+)/.exec(r.headers.get('content-security-policy')!)![1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
  });

  it('lets /login and /logout through without a session', async () => {
    expect((await call('/login')).status).toBe(200);
    expect((await call('/logout', {}, 'POST')).status).toBe(200);
  });

  it('redirects to /login with no session cookies', async () => {
    const res = await call('/');
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/login');
  });

  it('passes through with a valid access cookie, without refreshing', async () => {
    expect((await call('/', { '__Host-access': 'a' })).status).toBe(200);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes when only the refresh cookie is left and writes the rotated cookies', async () => {
    refreshSession.mockResolvedValue({ kind: 'ok', accessToken: 'a2', expiresIn: 600, refreshToken: 'r2' });
    const res = await call('/', { '__Host-refresh': 'r1' });
    expect(refreshSession).toHaveBeenCalledWith('r1', '203.0.113.7');
    expect(res.status).toBe(200);
    const cookies = setCookie(res).join('\n');
    expect(cookies).toMatch(/__Host-access=a2.*HttpOnly/is);
    expect(cookies).toMatch(/__Host-refresh=r2/);
    expect(res.headers.get('x-middleware-request-cookie') ?? '').toContain('__Host-access=a2');
  });

  it('on a rejected refresh redirects to /login and clears the session cookies', async () => {
    refreshSession.mockResolvedValue({ kind: 'rejected' });
    const res = await call('/', { '__Host-refresh': 'r1' });
    expect(location(res)).toBe('/login');
    expect(setCookie(res).join('\n')).toMatch(/__Host-refresh=;/);
  });

  it('answers 503 (and keeps the cookies) when the API is unreachable', async () => {
    refreshSession.mockResolvedValue({ kind: 'unavailable' });
    const res = await call('/', { '__Host-refresh': 'r1' });
    expect(res.status).toBe(503);
    expect(setCookie(res)).toEqual([]);
  });

  it('sends a must-change-password user to /cambiar-contrasena, but not away from it', async () => {
    const cookies = { '__Host-access': 'a', '__Host-must_change_password': '1' };
    expect(location(await call('/', cookies))).toBe('/cambiar-contrasena');
    expect((await call('/cambiar-contrasena', cookies)).status).toBe(200);
  });
});
