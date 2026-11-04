import { afterEach, describe, expect, it, vi } from 'vitest';
import createClient from 'openapi-fetch';
import type { paths } from '../api/schema';
import { fetchHealth } from '../api/health';
import { parseServerEnv } from '../env';

describe('parseServerEnv', () => {
  it('accepts a valid API_URL', () => {
    expect(parseServerEnv({ API_URL: 'http://localhost:4000' }).API_URL).toBe('http://localhost:4000');
  });

  it('rejects a missing or non-http API_URL', () => {
    expect(() => parseServerEnv({})).toThrow(/API_URL/);
    expect(() => parseServerEnv({ API_URL: 'ftp://x.test' })).toThrow(/API_URL/);
  });
});

function clientWith(fetchImpl: typeof fetch) {
  return createClient<paths>({ baseUrl: 'http://api.test', fetch: fetchImpl });
}

describe('fetchHealth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns the health report on 200', async () => {
    const body = { status: 'ok', db: 'up', version: '1.2.3' };
    const fetchImpl = vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
    expect(await fetchHealth(clientWith(fetchImpl))).toEqual({ ok: true, health: body });
  });

  it('maps an error body to bad-response', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'x', message: 'boom' } }, { status: 500 }),
    ) as unknown as typeof fetch;
    expect(await fetchHealth(clientWith(fetchImpl))).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('maps network failures to unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await fetchHealth(clientWith(fetchImpl))).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('reports misconfiguration and logs only name/message', async () => {
    vi.stubEnv('API_URL', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fetchHealth()).toEqual({ ok: false, reason: 'misconfigured' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('Invalid server environment');
  });

  it('logs network failures without leaking the URL', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await fetchHealth(clientWith(fetchImpl));
    expect(spy).toHaveBeenCalledWith('health: request failed: TypeError: fetch failed');
  });
});
