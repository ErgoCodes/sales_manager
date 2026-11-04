import 'server-only';
import { createApiClient } from './client';
import type { components } from './schema';

export type HealthReport = components['schemas']['HealthResponse_Output'];

export type HealthResult =
  | { ok: true; health: HealthReport }
  | { ok: false; reason: 'unreachable' | 'bad-response' | 'misconfigured' };

const HEALTH_TIMEOUT_MS = 3000;

/**
 * Reads GET /health. Never throws: network errors, timeouts, invalid
 * configuration and non-2xx answers all become `{ ok: false }` so the page
 * can render a controlled error state instead of crashing.
 */
export async function fetchHealth(client?: ReturnType<typeof createApiClient>): Promise<HealthResult> {
  let api: ReturnType<typeof createApiClient>;
  try {
    api = client ?? createApiClient();
  } catch (err) {
    logServerError('health: invalid configuration', err);
    return { ok: false, reason: 'misconfigured' };
  }
  try {
    const { data, error } = await api.GET('/health', {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (error || !data) return { ok: false, reason: 'bad-response' };
    return { ok: true, health: data };
  } catch (err) {
    logServerError('health: request failed', err);
    return { ok: false, reason: 'unreachable' };
  }
}

// Logs only the error name/message server-side (never the URL or env values).
function logServerError(context: string, err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`${context}: ${e.name}: ${e.message}`);
}
