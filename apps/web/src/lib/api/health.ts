import 'server-only';
import { createApiClient } from './client';
import type { components } from './schema';

export type HealthReport = components['schemas']['HealthResponse_Output'];

export type HealthResult =
  | { ok: true; health: HealthReport }
  | { ok: false; reason: 'unreachable' | 'bad-response' };

const HEALTH_TIMEOUT_MS = 3000;

/**
 * Reads GET /health. Never throws: network errors, timeouts, invalid
 * configuration and non-2xx answers all become `{ ok: false }` so the page
 * can render a controlled error state instead of crashing.
 */
export async function fetchHealth(client?: ReturnType<typeof createApiClient>): Promise<HealthResult> {
  try {
    const api = client ?? createApiClient();
    const { data, error } = await api.GET('/health', {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (error || !data) return { ok: false, reason: 'bad-response' };
    return { ok: true, health: data };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
