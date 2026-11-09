import type { AssignmentScope } from '@monaco/contracts';

import type { AuthenticatedActor } from '../domain/actor';
import type { AccessTokenService, StoredAssignment, TenantUnitOfWork } from '../domain/auth-ports';
import { effectivePermissions } from '../domain/permissions';
import type { Assignment, Scope } from '../domain/types';

export const isLiveAssignment = (a: StoredAssignment): boolean =>
  a.scope === 'tenant' || a.locationIds.length > 0;

export function toScope(stored: StoredAssignment | Scope): AssignmentScope {
  if ('type' in stored) {
    return stored.type === 'tenant' ? { type: 'tenant' } : { type: 'locations', locationIds: [...stored.locationIds] };
  }
  return stored.scope === 'tenant' ? { type: 'tenant' } : { type: 'locations', locationIds: [...stored.locationIds] };
}

export function toAssignments(stored: readonly StoredAssignment[]): Assignment[] {
  return stored
    .filter(isLiveAssignment)
    .map((a) => ({
      role: { id: a.roleId, key: a.roleKey, isSystem: a.isSystem, permissions: a.permissions },
      scope: toScope(a),
    }));
}

/**
 * Per-request authentication (AuthGuard): verifies the access token, then, in
 * one query inside the tenant's unit of work, checks that the user is active,
 * the device and the session (refresh family) are not revoked, and resolves the
 * effective permissions. Disabling a user, revoking a device or logging out
 * therefore cuts access on the very next request, not when the JWT expires.
 */
export class Authenticate {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly uow: TenantUnitOfWork,
  ) {}

  async execute(token: string): Promise<AuthenticatedActor | null> {
    const claims = await this.accessTokens.verify(token);
    if (!claims) return null;
    const state = await this.uow.run(claims.tid, (scope) => scope.actors.load(claims.sub, claims.did, claims.sid));
    if (!state?.userActive || !state.deviceActive || !state.sessionActive) return null;
    const assignments = toAssignments(state.assignments);
    return {
      userId: claims.sub,
      tenantId: claims.tid,
      deviceId: claims.did,
      sessionId: claims.sid,
      mustChangePassword: state.mustChangePassword,
      assignments,
      effective: effectivePermissions(assignments),
    };
  }
}
