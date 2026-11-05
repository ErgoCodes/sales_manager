import type {
  CreateUserRequest,
  CreateUserResponse,
  Paginated,
  ResetPasswordResponse,
  UpdateUserRequest,
  User,
  UserDetail,
} from '@monaco/contracts';

import { type AdminRequest, iso, runAdmin } from '../../iam/application/admin-support';
import { toAssignments } from '../../iam/application/authenticate.use-case';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import type { AdminTenantScope, AdminUnitOfWork, PageRequest } from '../../iam/domain/admin-ports';
import { AUTH_POLICY, type SessionRevocationReason } from '../../iam/domain/auth-policy';
import type { Clock, PasswordHasher } from '../../iam/domain/auth-ports';
import { ResourceConflict, ResourceNotFound } from '../../iam/domain/errors';
import { assertNoEscalation } from '../../iam/domain/escalation';
import { assertOwnerInvariant } from '../../iam/domain/owner';
import { authorize } from '../../iam/domain/permissions';
import type { ManagedUser, TemporaryPasswordGenerator } from '../domain/user-admin-ports';

/** Same message whether the email exists in this tenant, another one, or the insert failed: no enumeration. */
export const USER_CREATE_CONFLICT_MESSAGE = 'Could not create the user';

export const toUser = (user: ManagedUser): User => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  status: user.status,
  mustChangePassword: user.mustChangePassword,
  createdAt: iso(user.createdAt),
});

/** The target of a user mutation (404 if missing or of another tenant) and its current assignments. */
async function loadTarget(scope: AdminTenantScope, id: string) {
  const user = await scope.userAdmin.findById(id);
  if (!user) throw new ResourceNotFound('user');
  return { user, assignments: toAssignments(await scope.assignments.listByUser(id)) };
}

/**
 * Cuts every session of a user: revokes all their devices, then their tokens
 * (lock order device, then tokens, as everywhere else). Returns how many devices.
 */
async function revokeEverySession(scope: AdminTenantScope, userId: string, reason: SessionRevocationReason, now: Date): Promise<number> {
  const devices = await scope.devices.revokeAllExcept(userId, null, now);
  await scope.refreshTokens.revokeByDevices(devices, reason, now);
  return devices.length;
}

/** GET /users (`users:manage`). */
export class ListUsers {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(actor: AuthenticatedActor, page: PageRequest): Promise<Paginated<User>> {
    authorize(actor, 'users:manage');
    const result = await this.uow.run(actor.tenantId, (scope) => scope.userAdmin.list(page));
    return { items: result.items.map(toUser), nextCursor: result.nextCursor };
  }
}

/** GET /users/:id (`users:manage`): the user with their assignments. */
export class GetUser {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(actor: AuthenticatedActor, id: string): Promise<UserDetail> {
    authorize(actor, 'users:manage');
    const { user, stored } = await this.uow.run(actor.tenantId, async (scope) => {
      const found = await scope.userAdmin.findById(id);
      if (!found) throw new ResourceNotFound('user');
      return { user: found, stored: await scope.assignments.listByUser(id) };
    });
    return {
      ...toUser(user),
      // An assignment whose locations are all archived grants nothing and has no valid scope to show.
      assignments: stored
        .filter((a) => a.scope === 'tenant' || a.locationIds.length > 0)
        .map((a) => ({
          id: a.id,
          roleId: a.roleId,
          scope: a.scope === 'tenant' ? { type: 'tenant' } : { type: 'locations', locationIds: [...a.locationIds] },
        })),
    };
  }
}

type CreateOutcome = { ok: true; user: ManagedUser } | { ok: false };

/**
 * POST /users (`users:manage`, rate limited). The server generates the
 * temporary password (72 h, `must_change_password`). An existing email, in
 * any tenant, is a generic 409 plus a `user_create_conflict` audit event,
 * committed before the error.
 */
export class CreateUser {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly passwords: TemporaryPasswordGenerator,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, input: CreateUserRequest): Promise<CreateUserResponse> {
    authorize(actor, 'users:manage');
    const now = this.clock.now();
    const temporaryPassword = this.passwords.generate();
    const expiresAt = new Date(now.getTime() + AUTH_POLICY.temporaryPasswordTtlMs);
    const passwordHash = await this.hasher.hash(temporaryPassword);
    const outcome = await this.uow.run<CreateOutcome>(actor.tenantId, async (scope) => {
      const user = await scope.userAdmin.create({ ...input, passwordHash, passwordExpiresAt: expiresAt, now });
      if (!user) {
        await scope.audit.record({ type: 'user_create_conflict', actorUserId: actor.userId, targetType: 'user', metadata: { email: input.email }, ip });
        return { ok: false };
      }
      await scope.audit.record({ type: 'user_created', actorUserId: actor.userId, targetType: 'user', targetId: user.id, metadata: { email: user.email }, ip });
      return { ok: true, user };
    });
    if (!outcome.ok) throw new ResourceConflict(USER_CREATE_CONFLICT_MESSAGE);
    return { user: toUser(outcome.user), temporaryPassword, temporaryPasswordExpiresAt: iso(expiresAt) };
  }
}

/** PATCH /users/:id (`users:manage`): oneself, or someone the actor covers (ADR 0005, `update_user`). */
export class UpdateUser {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(request: AdminRequest, id: string, changes: UpdateUserRequest): Promise<User> {
    const { actor, ip } = request;
    authorize(actor, 'users:manage');
    const user = await runAdmin(this.uow, request, 'update_user', { type: 'user', id }, async (scope) => {
      const target = await loadTarget(scope, id);
      assertNoEscalation(actor, { kind: 'update_user', targetUserId: id, targetAssignments: target.assignments });
      const updated = (await scope.userAdmin.updateDisplayName(id, changes.displayName))!;
      await scope.audit.record({ type: 'user_updated', actorUserId: actor.userId, targetType: 'user', targetId: id, metadata: { ...changes }, ip });
      return updated;
    });
    return toUser(user);
  }
}

/**
 * POST /users/:id/disable (`users:manage`). Revokes every device and session
 * of the user (the live access token gets 401 on its next request). Takes the
 * tenant mutex and keeps the Owner invariant (409).
 */
export class DisableUser {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, id: string): Promise<User> {
    const { actor, ip } = request;
    authorize(actor, 'users:manage');
    const now = this.clock.now();
    const user = await runAdmin(this.uow, request, 'disable_user', { type: 'user', id }, async (scope) => {
      await scope.mutex.lock();
      const target = await loadTarget(scope, id);
      assertNoEscalation(actor, { kind: 'disable_user', targetUserId: id, targetAssignments: target.assignments });
      const disabled = (await scope.userAdmin.disable(id))!;
      const revokedDevices = await revokeEverySession(scope, id, 'user_disabled', now);
      assertOwnerInvariant(await scope.assignments.ownerCandidates());
      await scope.audit.record({ type: 'user_disabled', actorUserId: actor.userId, targetType: 'user', targetId: id, metadata: { revokedDevices }, ip });
      return disabled;
    });
    return toUser(user);
  }
}

/**
 * POST /users/:id/reset-password (`users:manage`). An account takeover in
 * all but name, so the actor must cover everything the target holds. The old
 * password stops working, every session is revoked, and the new temporary
 * password lasts 72 h.
 */
export class ResetUserPassword {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly passwords: TemporaryPasswordGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, id: string): Promise<ResetPasswordResponse> {
    const { actor, ip } = request;
    authorize(actor, 'users:manage');
    const now = this.clock.now();
    const temporaryPassword = this.passwords.generate();
    const expiresAt = new Date(now.getTime() + AUTH_POLICY.temporaryPasswordTtlMs);
    const passwordHash = await this.hasher.hash(temporaryPassword);
    await runAdmin(this.uow, request, 'reset_password', { type: 'user', id }, async (scope) => {
      await scope.mutex.lock();
      const target = await loadTarget(scope, id);
      assertNoEscalation(actor, { kind: 'reset_password', targetUserId: id, targetAssignments: target.assignments });
      await scope.userAdmin.setTemporaryPassword(id, passwordHash, expiresAt);
      const revokedDevices = await revokeEverySession(scope, id, 'password_reset', now);
      assertOwnerInvariant(await scope.assignments.ownerCandidates());
      await scope.audit.record({ type: 'user_password_reset', actorUserId: actor.userId, targetType: 'user', targetId: id, metadata: { revokedDevices }, ip });
    });
    return { temporaryPassword, temporaryPasswordExpiresAt: iso(expiresAt) };
  }
}
