import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === '__Host-access' ? { value: 'tok' } : undefined), set: vi.fn() }),
  headers: async () => new Headers({ 'x-real-ip': '198.51.100.4' }),
}));
vi.mock('@/lib/env', () => ({
  parseServerEnv: () => ({ API_URL: 'http://api.test', CLIENT_IP_HMAC_SECRET: 'x'.repeat(32) }),
  trustedProxyHops: () => 1,
}));

import { createAnonymousClient, createAuthenticatedClient } from '../authenticated';

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
});

describe('authenticated clients', () => {
  it('the authenticated client sends bearer + signed IP', async () => {
    const api = await createAuthenticatedClient({ canRefresh: false });
    await api.GET('/me');
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer tok');
    expect(request.headers.get('x-monaco-client-ip')).toMatch(/^v1;198\.51\.100\.4;/);
  });
  it('the anonymous client sends the signed IP but no bearer', async () => {
    const api = await createAnonymousClient();
    await api.POST('/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(12) } });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.headers.has('authorization')).toBe(false);
    expect(request.headers.get('x-monaco-client-ip')).toMatch(/^v1;198\.51\.100\.4;/);
  });
});
