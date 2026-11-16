import 'server-only';
import { cookies, headers } from 'next/headers';
import { clientIpFromHeaders } from '@/lib/security/client-ip';
import { applyTokens, clearSession, readSession } from './cookies';
import { refreshSession } from './refresh-api';

/** Reads the session cookies. Safe in Server Components (read only); never refreshes there. */
export async function getSession() {
  return readSession(await cookies());
}

export async function getClientIp(): Promise<string | null> {
  return clientIpFromHeaders(await headers());
}

/**
 * Refreshes the session and writes the rotated cookies. Only callable where cookies are
 * writable: Server Actions and Route Handlers (the proxy does its own, see src/proxy.ts).
 * Returns the new access token, or null when the session is over or the API is unreachable.
 */
export async function refreshSessionCookies(): Promise<string | null> {
  const jar = await cookies();
  const { refreshToken } = readSession(jar);
  if (!refreshToken) return null;
  const result = await refreshSession(refreshToken, await getClientIp());
  if (result.kind === 'ok') {
    applyTokens(jar, result);
    return result.accessToken;
  }
  if (result.kind === 'rejected') clearSession(jar);
  return null;
}

export { applyTokens, clearSession };
