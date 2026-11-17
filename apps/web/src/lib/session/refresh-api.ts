import 'server-only';
import createClient from 'openapi-fetch';
import { createBffFetch } from '@/lib/api/bff-fetch';
import type { paths } from '@/lib/api/schema';
import { parseServerEnv } from '@/lib/env';
import { createRefresher, type RefreshResult } from './refresh';

const REFRESH_TIMEOUT_MS = 5000;

async function callRefresh(refreshToken: string, ip: string | null): Promise<RefreshResult> {
  const env = parseServerEnv();
  const api = createClient<paths>({ baseUrl: env.API_URL, fetch: createBffFetch({ secret: env.CLIENT_IP_HMAC_SECRET, ip }) });
  try {
    const { data, response } = await api.POST('/auth/refresh', {
      body: { refreshToken },
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (data) return { kind: 'ok', accessToken: data.accessToken, expiresIn: data.expiresIn, refreshToken: data.refreshToken };
    // 429 and 5xx say nothing about the session; any other 4xx means it is over.
    return response.status >= 500 || response.status === 429 ? { kind: 'unavailable' } : { kind: 'rejected' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Process-wide single-flight refresh (the map must outlive each request). */
export const refreshSession = createRefresher<string | null>(callRefresh);
