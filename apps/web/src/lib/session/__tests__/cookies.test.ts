import { describe, expect, it } from 'vitest';
import {
  ACCESS_COOKIE,
  DEVICE_COOKIE,
  MUST_CHANGE_COOKIE,
  REFRESH_COOKIE,
  applyTokens,
  clearSession,
  readSession,
  type CookieWriter,
} from '../cookies';

type Call = { name: string; value: string; options: Record<string, unknown> };
function fakeJar(initial: Record<string, string> = {}) {
  const calls: Call[] = [];
  const store = new Map(Object.entries(initial));
  const jar: CookieWriter & { get(name: string): { value: string } | undefined } = {
    set(name, value, options) {
      calls.push({ name, value, options: options as unknown as Record<string, unknown> });
      if (options.maxAge === 0) store.delete(name);
      else store.set(name, value);
    },
    get: (name) => (store.has(name) ? { value: store.get(name)! } : undefined),
  };
  return { jar, calls, store };
}
const last = (calls: Call[], name: string) => [...calls].reverse().find((c) => c.name === name)!;

describe('cookie attributes', () => {
  it('uses __Host- cookies: httpOnly, Secure, Path=/, no Domain; access Lax, refresh Strict', () => {
    const { jar, calls } = fakeJar();
    applyTokens(jar, { accessToken: 'a', expiresIn: 600, refreshToken: 'r', deviceId: 'd', mustChangePassword: false });
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE]) {
      expect(name.startsWith('__Host-')).toBe(true);
      const { options } = last(calls, name);
      expect(options).toMatchObject({ httpOnly: true, secure: true, path: '/' });
      expect(options).not.toHaveProperty('domain');
    }
    expect(last(calls, ACCESS_COOKIE).options.sameSite).toBe('lax');
    expect(last(calls, REFRESH_COOKIE).options.sameSite).toBe('strict');
  });

  it('expires the access cookie before the JWT does', () => {
    const { jar, calls } = fakeJar();
    applyTokens(jar, { accessToken: 'a', expiresIn: 600 });
    expect(last(calls, ACCESS_COOKIE).options.maxAge).toBe(570);
  });

  it('keeps the refresh and device cookies when the response carries none (grace window)', () => {
    const { jar, calls } = fakeJar({ [REFRESH_COOKIE]: 'old' });
    applyTokens(jar, { accessToken: 'a2', expiresIn: 600 });
    expect(calls.map((c) => c.name)).toEqual([ACCESS_COOKIE]);
    expect(jar.get(REFRESH_COOKIE)?.value).toBe('old');
  });

  it('stores the must-change flag only while it is true', () => {
    const { jar, calls, store } = fakeJar();
    applyTokens(jar, { accessToken: 'a', expiresIn: 600, mustChangePassword: true });
    expect(store.get(MUST_CHANGE_COOKIE)).toBe('1');
    applyTokens(jar, { accessToken: 'a', expiresIn: 600, mustChangePassword: false });
    expect(store.has(MUST_CHANGE_COOKIE)).toBe(false);
    expect(last(calls, MUST_CHANGE_COOKIE).options).toMatchObject({ maxAge: 0, secure: true, path: '/' });
  });
});

describe('clearSession', () => {
  it('deletes session cookies with the attributes __Host- requires, and keeps the device id', () => {
    const { jar, calls, store } = fakeJar({ [ACCESS_COOKIE]: 'a', [REFRESH_COOKIE]: 'r', [MUST_CHANGE_COOKIE]: '1', [DEVICE_COOKIE]: 'd' });
    clearSession(jar);
    expect([...store.keys()]).toEqual([DEVICE_COOKIE]);
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, MUST_CHANGE_COOKIE]) {
      expect(last(calls, name).options).toMatchObject({ maxAge: 0, secure: true, path: '/', httpOnly: true });
    }
  });
});

describe('readSession', () => {
  const read = (values: Record<string, string>) => readSession({ get: (n) => (n in values ? { value: values[n]! } : undefined) });
  it('reads tokens, flag and a valid device id', () => {
    const id = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b';
    expect(read({ [ACCESS_COOKIE]: 'a', [REFRESH_COOKIE]: 'r', [MUST_CHANGE_COOKIE]: '1', [DEVICE_COOKIE]: id })).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      mustChangePassword: true,
      deviceId: id,
    });
  });
  it('treats a malformed device id as absent and an empty jar as no session', () => {
    expect(read({ [DEVICE_COOKIE]: 'not-a-uuid' }).deviceId).toBeUndefined();
    expect(read({})).toEqual({ accessToken: undefined, refreshToken: undefined, mustChangePassword: false, deviceId: undefined });
  });
});
