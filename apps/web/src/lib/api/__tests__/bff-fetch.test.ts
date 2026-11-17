import { describe, expect, it, vi } from 'vitest';
import { signClientIp } from '@/lib/security/client-ip';
import { createBffFetch } from '../bff-fetch';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = 1_760_000_000_000;

function setup(responses: number[], extra: Partial<Parameters<typeof createBffFetch>[0]> = {}) {
  const seen: Request[] = [];
  const baseFetch = vi.fn(async (req: Request) => {
    seen.push(req);
    return new Response('{}', { status: responses.shift() ?? 200 });
  });
  const fetch = createBffFetch({ secret: SECRET, ip: '203.0.113.7', baseFetch: baseFetch as unknown as typeof globalThis.fetch, now: () => NOW, ...extra });
  return { fetch, seen, baseFetch };
}
const req = (path = '/me', init?: RequestInit) => new Request(`http://api.test${path}?x=1`, init);

describe('createBffFetch', () => {
  it('adds the bearer and a signed IP header over method and path (no query)', async () => {
    const { fetch, seen } = setup([200], { accessToken: 'tok' });
    await fetch(req('/me'));
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer tok');
    expect(seen[0]!.headers.get('x-monaco-client-ip')).toBe(
      signClientIp({ secret: SECRET, ip: '203.0.113.7', method: 'GET', path: '/me', timestamp: NOW / 1000 }),
    );
  });

  it('omits the IP header without a secret or a valid IP, and the bearer without a token', async () => {
    const a = setup([200], { secret: undefined });
    await a.fetch(req());
    expect(a.seen[0]!.headers.has('x-monaco-client-ip')).toBe(false);
    expect(a.seen[0]!.headers.has('authorization')).toBe(false);
    const b = setup([200], { ip: null });
    await b.fetch(req());
    expect(b.seen[0]!.headers.has('x-monaco-client-ip')).toBe(false);
  });

  it('on 401 refreshes once and retries with the new token and the same body', async () => {
    const refresh = vi.fn(async () => 'tok2');
    const { fetch, seen, baseFetch } = setup([401, 200], { accessToken: 'tok', refresh });
    const res = await fetch(req('/auth/password', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(seen[1]!.headers.get('authorization')).toBe('Bearer tok2');
    expect(await seen[1]!.text()).toBe('{"a":1}');
  });

  it('returns the second 401 without looping when the retry also fails', async () => {
    const refresh = vi.fn(async () => 'tok2');
    const { fetch, baseFetch } = setup([401, 401], { accessToken: 'tok', refresh });
    expect((await fetch(req())).status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('returns the 401 when the refresh yields nothing', async () => {
    const { fetch, baseFetch } = setup([401], { accessToken: 'tok', refresh: async () => null });
    expect((await fetch(req())).status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh when no refresh callback is given (Server Components)', async () => {
    const { fetch, baseFetch } = setup([401], { accessToken: 'tok' });
    expect((await fetch(req())).status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
