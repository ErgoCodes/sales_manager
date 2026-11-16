// Session cookies (ADR 0004 §9). `__Host-` requires Secure, Path=/ and no Domain.
// Chrome and Firefox accept Secure cookies on http://localhost, so dev works.
export const ACCESS_COOKIE = '__Host-access';
export const REFRESH_COOKIE = '__Host-refresh';
export const DEVICE_COOKIE = '__Host-device_id';
/** UX hint only (proxy redirect); the API enforces must_change_password itself. */
export const MUST_CHANGE_COOKIE = '__Host-must_change_password';

const DAY = 60 * 60 * 24;
const REFRESH_MAX_AGE = 30 * DAY; // sliding refresh lifetime (ADR 0004 §2)
const DEVICE_MAX_AGE = 400 * DAY; // browsers cap cookie lifetime at 400 days
/** The access cookie expires this many seconds before its JWT, so the proxy refreshes ahead of a 401. */
const ACCESS_SKEW = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CookieOptions {
  httpOnly: true;
  secure: true;
  path: '/';
  sameSite: 'lax' | 'strict';
  maxAge: number;
}
/** What both `NextResponse.cookies` and the `cookies()` store of Actions/Route Handlers offer. */
export interface CookieWriter {
  set(name: string, value: string, options: CookieOptions): unknown;
}
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

const base = { httpOnly: true, secure: true, path: '/' } as const;

export interface TokenSet {
  accessToken: string;
  expiresIn: number;
  /** Absent when the API served a refresh from its grace window: keep the cookie we have. */
  refreshToken?: string;
  deviceId?: string;
  /** Undefined leaves the flag as it is (refresh does not report it). */
  mustChangePassword?: boolean;
}

export function applyTokens(jar: CookieWriter, tokens: TokenSet): void {
  jar.set(ACCESS_COOKIE, tokens.accessToken, { ...base, sameSite: 'lax', maxAge: Math.max(tokens.expiresIn - ACCESS_SKEW, 1) });
  if (tokens.refreshToken) jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, sameSite: 'strict', maxAge: REFRESH_MAX_AGE });
  if (tokens.deviceId) jar.set(DEVICE_COOKIE, tokens.deviceId, { ...base, sameSite: 'lax', maxAge: DEVICE_MAX_AGE });
  if (tokens.mustChangePassword === true) jar.set(MUST_CHANGE_COOKIE, '1', { ...base, sameSite: 'lax', maxAge: REFRESH_MAX_AGE });
  else if (tokens.mustChangePassword === false) expire(jar, MUST_CHANGE_COOKIE, 'lax');
}

// A `__Host-` cookie can only be overwritten by a Set-Cookie that is itself Secure/Path=/,
// so deletion is an explicit empty value with maxAge 0, not `cookies.delete()`.
function expire(jar: CookieWriter, name: string, sameSite: 'lax' | 'strict'): void {
  jar.set(name, '', { ...base, sameSite, maxAge: 0 });
}

/** Removes the session cookies. The device id stays: a later login on this browser reuses the device. */
export function clearSession(jar: CookieWriter): void {
  expire(jar, ACCESS_COOKIE, 'lax');
  expire(jar, REFRESH_COOKIE, 'strict');
  expire(jar, MUST_CHANGE_COOKIE, 'lax');
}

export interface SessionCookies {
  accessToken: string | undefined;
  refreshToken: string | undefined;
  mustChangePassword: boolean;
  deviceId: string | undefined;
}

export function readSession(jar: CookieReader): SessionCookies {
  const device = jar.get(DEVICE_COOKIE)?.value;
  return {
    accessToken: jar.get(ACCESS_COOKIE)?.value || undefined,
    refreshToken: jar.get(REFRESH_COOKIE)?.value || undefined,
    mustChangePassword: jar.get(MUST_CHANGE_COOKIE)?.value === '1',
    deviceId: device && UUID.test(device) ? device : undefined,
  };
}
