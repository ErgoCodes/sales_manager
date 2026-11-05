/**
 * Typed IAM domain errors. The domain knows nothing about HTTP; the application/http
 * layer maps them (SP2 · T4):
 *
 * | Error                    | HTTP | Notes                                          |
 * |--------------------------|------|------------------------------------------------|
 * | `ForbiddenEscalation`    | 403  | Generic message; `reason` goes to the audit log |
 * | `OwnerInvariantViolation`| 409  | Last active Owner would be lost                 |
 * | `SystemRoleImmutable`    | 409  | Owner role edit, or any system role delete      |
 * | `RoleInUse`              | 409  | Role still has assignments                      |
 * | `InvalidScope`           | 422  | Malformed scope or admin permission off-tenant  |
 */
export abstract class IamDomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export type EscalationReason =
  /** The actor tried to change their own assignments, or disable/reset themselves. */
  | 'self_modification'
  /** Operation reserved to Owners (Owner role, touching an Owner, owner-only permissions). */
  | 'owner_only'
  /** The actor does not hold a permission they tried to hand out. */
  | 'permission_not_held'
  /** The actor holds the permission, but with a narrower scope than the one requested. */
  | 'scope_exceeds';

export class ForbiddenEscalation extends IamDomainError {
  readonly code = 'forbidden_escalation';

  constructor(readonly reason: EscalationReason) {
    super(`Forbidden privilege escalation: ${reason}`);
  }
}

export class OwnerInvariantViolation extends IamDomainError {
  readonly code = 'owner_invariant_violation';

  constructor() {
    super('A tenant must keep at least one active Owner with tenant-wide scope');
  }
}

export type InvalidScopeReason =
  | 'empty_locations'
  | 'duplicate_locations'
  | 'admin_permission_requires_tenant_scope';

export class InvalidScope extends IamDomainError {
  readonly code = 'invalid_scope';

  constructor(readonly reason: InvalidScopeReason) {
    super(`Invalid assignment scope: ${reason}`);
  }
}

export class SystemRoleImmutable extends IamDomainError {
  readonly code = 'system_role_immutable';

  constructor(readonly operation: 'update' | 'delete') {
    super(`System role cannot be ${operation === 'update' ? 'edited' : 'deleted'}`);
  }
}

export class RoleInUse extends IamDomainError {
  readonly code = 'role_in_use';

  constructor() {
    super('Role still has assignments');
  }
}
