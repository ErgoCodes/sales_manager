import type { AssignmentScope } from '@monaco/contracts';

import type { AuthenticatedActor } from '../domain/actor';
import type { AdminTenantScope, AdminUnitOfWork } from '../domain/admin-ports';
import type { StoredAssignment } from '../domain/auth-ports';
import { ForbiddenEscalation } from '../domain/errors';
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
  return stored.map((a) => ({
    role: { id: a.roleId, key: a.roleKey, isSystem: a.isSystem, permissions: a.permissions },
    scope: toScope(a),
  }));
}

/** Who asks, and from where (the signed client IP), for the audit log. */
export interface AdminRequest {
  readonly actor: AuthenticatedActor;
  readonly ip: string | null;
}

/**
 * Runs an administration use case in one tenant transaction. A rejected
 * privilege escalation rolls that transaction back, so its reason (which the
 * 403 never reveals, ADR 0005 §6) is recorded as `escalation_denied` in a
 * transaction of its own before the error goes on to the client.
 */
export async function runAdmin<T>(
  uow: AdminUnitOfWork,
  request: AdminRequest,
  operation: string,
  target: { readonly type: string; readonly id?: string },
  work: (scope: AdminTenantScope) => Promise<T>,
): Promise<T> {
  try {
    return await uow.run(request.actor.tenantId, work);
  } catch (error) {
    if (error instanceof ForbiddenEscalation) {
      await uow.run(request.actor.tenantId, (scope) =>
        scope.audit.record({
          type: 'escalation_denied',
          actorUserId: request.actor.userId,
          targetType: target.type,
          targetId: target.id,
          metadata: { operation, reason: error.reason },
          ip: request.ip,
        }),
      );
    }
    throw error;
  }
}

/** ISO 8601 for the response contracts (`IsoDateTime`). */
export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());
