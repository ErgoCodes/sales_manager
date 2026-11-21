import 'server-only';
import { redirect } from 'next/navigation';
import { describeApiError, errorCode, errorDetails, type ErrorDetail } from '@/lib/api-errors';
import { createAuthenticatedClient } from './authenticated';

type Client = Awaited<ReturnType<typeof createAuthenticatedClient>>;
interface RawResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** A failure carries the stable `code` and `details` when the API sent them, for callers that refine the message. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; code?: string; details?: ErrorDetail[] };

/** Per-request options shared by every back-office call: bounded wait, never cached. */
export function requestInit() {
  return { signal: AbortSignal.timeout(10_000), cache: 'no-store' as const };
}

/**
 * Runs one API call and turns every outcome into a value the UI can render:
 * success, or a Spanish message for 403/404/409/422/429/5xx and for network failures.
 * A 401 means the session is over: redirect to /login.
 * `canRefresh` is true in Server Actions and Route Handlers, false in Server Components.
 */
export async function callApi<T>(call: (api: Client) => Promise<RawResult<T>>, { canRefresh }: { canRefresh: boolean }): Promise<ApiResult<T>> {
  let result: RawResult<T>;
  try {
    result = await call(await createAuthenticatedClient({ canRefresh }));
  } catch {
    return { ok: false, status: 0, message: 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos minutos.' };
  }
  const { response } = result;
  if (response.status === 401) redirect('/login');
  if (!response.ok) {
    const code = errorCode(result.error);
    const details = errorDetails(result.error);
    return { ok: false, status: response.status, message: describeApiError(response.status, code), ...(code ? { code } : {}), ...(details.length > 0 ? { details } : {}) };
  }
  return { ok: true, data: result.data as T };
}
