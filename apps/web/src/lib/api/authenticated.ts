import 'server-only';
import createClient from 'openapi-fetch';
import { parseServerEnv } from '@/lib/env';
import { getClientIp, getSession, refreshSessionCookies } from '@/lib/session/server';
import { createBffFetch } from './bff-fetch';
import type { paths } from './schema';

/**
 * API client for the signed-in user: bearer from the session cookie plus the signed client-IP header.
 * - `canRefresh: false` (Server Components, which cannot write cookies): a 401 is returned as is.
 * - `canRefresh: true` (Server Actions, Route Handlers): a 401 refreshes once (single-flight) and retries once.
 */
export async function createAuthenticatedClient({ canRefresh }: { canRefresh: boolean }) {
  const env = parseServerEnv();
  const session = await getSession();
  return createClient<paths>({
    baseUrl: env.API_URL,
    fetch: createBffFetch({
      secret: env.CLIENT_IP_HMAC_SECRET,
      ip: await getClientIp(),
      accessToken: session.accessToken,
      refresh: canRefresh ? refreshSessionCookies : undefined,
    }),
  });
}

/** Client for the endpoints that run before there is a session (login). */
export async function createAnonymousClient() {
  const env = parseServerEnv();
  return createClient<paths>({
    baseUrl: env.API_URL,
    fetch: createBffFetch({ secret: env.CLIENT_IP_HMAC_SECRET, ip: await getClientIp() }),
  });
}
