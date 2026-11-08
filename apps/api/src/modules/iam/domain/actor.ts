import type { Actor, EffectivePermissions } from './types';

/**
 * The authenticated caller of one request, resolved by the AuthGuard from the
 * access token and re-checked against the database on every request (user
 * active, device and session not revoked). Use cases receive it and open a
 * unit of work on `tenantId`.
 */
export interface AuthenticatedActor extends Actor {
  readonly tenantId: string;
  readonly deviceId: string;
  /** Refresh family of the current login (`sid` claim). */
  readonly sessionId: string;
  readonly mustChangePassword: boolean;
  readonly effective: EffectivePermissions;
}
