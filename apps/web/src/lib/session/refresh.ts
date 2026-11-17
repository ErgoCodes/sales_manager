import { createHash } from 'node:crypto';
import { createSingleFlight } from './single-flight';

export type RefreshResult =
  | { kind: 'ok'; accessToken: string; expiresIn: number; refreshToken?: string }
  /** The API said 401/400: the session is over (revoked, expired, reuse detected). */
  | { kind: 'rejected' }
  /** Network error or 5xx: the session may still be good, do not log the user out. */
  | { kind: 'unavailable' };

/**
 * Single-flight per session: concurrent refreshes of the same refresh token share one
 * API call and its result. Without it, the second call would present an already
 * rotated token (outside the grace window that is read as reuse and kills the family).
 * The first caller's context (client IP) is used for the shared call.
 * Scope: one Node process; across processes the API's row lock and 10 s grace window apply.
 */
export function createRefresher<Context = void>(call: (refreshToken: string, context: Context) => Promise<RefreshResult>) {
  const singleFlight = createSingleFlight<RefreshResult>();
  return (refreshToken: string, context: Context): Promise<RefreshResult> =>
    singleFlight(createHash('sha256').update(refreshToken).digest('hex'), () => call(refreshToken, context));
}
