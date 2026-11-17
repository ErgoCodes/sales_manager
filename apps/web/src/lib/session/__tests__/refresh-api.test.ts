import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshSession } from '../refresh-api';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('API_URL', 'http://api.test');
  vi.stubEnv('CLIENT_IP_HMAC_SECRET', 'x'.repeat(32));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (status: number, body?: unknown) => fetchMock.mockImplementation(async () => Response.json(body ?? {}, { status }));

describe('refreshSession (API call)', () => {
  it('maps 200 to ok and sends the signed IP header', async () => {
    reply(200, { accessToken: 'a2', expiresIn: 600, refreshToken: 'r2' });
    expect(await refreshSession('tok-1', '203.0.113.7')).toEqual({ kind: 'ok', accessToken: 'a2', expiresIn: 600, refreshToken: 'r2' });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(new URL(request.url).pathname).toBe('/auth/refresh');
    expect(request.headers.get('x-monaco-client-ip')).toMatch(/^v1;203\.0\.113\.7;\d+;/);
  });
  it('maps 401 to rejected, and 429/5xx/network errors to unavailable', async () => {
    reply(401);
    expect(await refreshSession('tok-2', null)).toEqual({ kind: 'rejected' });
    reply(429);
    expect(await refreshSession('tok-3', null)).toEqual({ kind: 'unavailable' });
    reply(502);
    expect(await refreshSession('tok-4', null)).toEqual({ kind: 'unavailable' });
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await refreshSession('tok-5', null)).toEqual({ kind: 'unavailable' });
  });
});
