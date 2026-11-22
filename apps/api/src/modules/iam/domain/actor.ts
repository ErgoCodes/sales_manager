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
  /** Always false in a read-only tenant: nobody may change a published password there. */
  readonly mustChangePassword: boolean;
  /**
   * The tenant is the read-only public demo: the AuthGuard denies every mutation
   * (SP4 · D10). `Authenticate` always sets it from the database; it is optional
   * only so that trusted scripts (seeds) can build an actor without it.
   */
  readonly tenantReadOnly?: boolean;
  readonly effective: EffectivePermissions;
}
