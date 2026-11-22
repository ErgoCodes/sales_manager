import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
const setSpy = vi.fn();
const post = vi.fn();
const getMe = vi.fn();
const authenticatedWith = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => jar.get(n),
    set: (n: string, value: string, options: Record<string, unknown>) => {
      setSpy(n, value, options);
      jar.set(n, { value, options });
    },
  }),
  headers: async () => new Headers({ 'user-agent': 'TestBrowser/1.0', 'x-forwarded-for': '203.0.113.7' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({
  createAnonymousClient: async () => ({ POST: post }),
  createAuthenticatedClient: async (options: unknown) => {
    authenticatedWith(options);
    return { GET: getMe };
  },
}));

import { loginAction } from '../actions';

const form = (email: string, password: string) => {
  const f = new FormData();
  f.set('email', email);
  f.set('password', password);
  return f;
};
const DEVICE = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b';

beforeEach(() => {
  jar.clear();
  setSpy.mockReset();
  post.mockReset();
  getMe.mockReset();
  authenticatedWith.mockReset();
  getMe.mockResolvedValue({ data: { permissions: [] }, response: { status: 200 } });
});

describe('loginAction', () => {
  it('rejects empty fields without calling the API', async () => {
    expect(await loginAction({}, form('', ''))).toEqual({ error: 'Ingresa tu correo y tu contraseña.' });
    expect(post).not.toHaveBeenCalled();
  });

  it('on success clears old session cookies first, sets the new ones and redirects', async () => {
    jar.set('__Host-access', { value: 'stale' });
    jar.set('__Host-refresh', { value: 'stale-r' });
    jar.set('__Host-device_id', { value: DEVICE });
    post.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: DEVICE, mustChangePassword: false }, response: { status: 200 } });
    await expect(loginAction({}, form(' a@b.co ', 'secret-password-1'))).rejects.toThrow('REDIRECT:/');
    expect(post.mock.calls[0]![1].body).toMatchObject({ email: 'a@b.co', deviceId: DEVICE, device: { label: 'TestBrowser/1.0', platform: 'web' } });
    const names = setSpy.mock.calls.map((c) => c[0]);
    expect(names.indexOf('__Host-access')).toBe(0); // clear (maxAge 0) comes before the new value
    expect(setSpy.mock.calls[0]![2]).toMatchObject({ maxAge: 0 });
    expect(jar.get('__Host-access')?.value).toBe('a');
    expect(jar.get('__Host-refresh')?.value).toBe('r');
  });

  it('sends a user who must change the password to /cambiar-contrasena', async () => {
    post.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: DEVICE, mustChangePassword: true }, response: { status: 200 } });
    await expect(loginAction({}, form('a@b.co', 'x'))).rejects.toThrow('REDIRECT:/cambiar-contrasena');
    expect(jar.get('__Host-must_change_password')?.value).toBe('1');
  });

  it.each([
    [401, /Revisa tus datos/],
    [400, /Revisa tus datos/],
    [429, /Demasiados intentos/],
    [503, /no está disponible/],
  ])('maps API status %i to a generic Spanish error and sets no cookies', async (status, message) => {
    post.mockResolvedValue({ data: undefined, response: { status } });
    const state = await loginAction({}, form('a@b.co', 'x'));
    expect(state.error).toMatch(message);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('lands a user with reports:view on /tablero, reading /me with the new access token', async () => {
    post.mockResolvedValue({ data: { accessToken: 'fresh', refreshToken: 'r', expiresIn: 600, deviceId: DEVICE, mustChangePassword: false }, response: { status: 200 } });
    getMe.mockResolvedValue({ data: { permissions: [{ permission: 'reports:view', scope: { type: 'locations', locationIds: [DEVICE] } }] }, response: { status: 200 } });
    await expect(loginAction({}, form('a@b.co', 'x'))).rejects.toThrow('REDIRECT:/tablero');
    expect(getMe).toHaveBeenCalledWith('/me', expect.anything());
    expect(authenticatedWith).toHaveBeenCalledWith({ canRefresh: false, accessToken: 'fresh' });
  });

  it.each([
    ['only reports:view_own (cashier)', async () => ({ data: { permissions: [{ permission: 'reports:view_own', scope: { type: 'tenant' } }] }, response: { status: 200 } })],
    ['a failed /me', async () => ({ data: undefined, response: { status: 503 } })],
    ['an unreachable API', async () => Promise.reject(new Error('down'))],
  ])('lands on / with %s', async (_label, me) => {
    post.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: DEVICE, mustChangePassword: false }, response: { status: 200 } });
    getMe.mockImplementation(me);
    await expect(loginAction({}, form('a@b.co', 'x'))).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it('a user who must change the password goes there even with reports:view, without reading /me', async () => {
    post.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: DEVICE, mustChangePassword: true }, response: { status: 200 } });
    await expect(loginAction({}, form('a@b.co', 'x'))).rejects.toThrow('REDIRECT:/cambiar-contrasena');
    expect(getMe).not.toHaveBeenCalled();
  });

  it('maps a network failure to a connection error', async () => {
    post.mockRejectedValue(new Error('down'));
    expect((await loginAction({}, form('a@b.co', 'x'))).error).toMatch(/conectar/);
  });
});
