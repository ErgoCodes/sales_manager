import type { AuthTokens } from '@monaco/contracts';

import type { AuthenticatedActor } from '../domain/actor';
import { InvalidCurrentPassword, InvalidSession } from '../domain/auth-errors';
import { AUTH_POLICY } from '../domain/auth-policy';
import type { AccessTokenService, Clock, PasswordHasher, RefreshTokenCodec, TenantUnitOfWork } from '../domain/auth-ports';

export interface ChangePasswordCommand {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly ip: string | null;
}

type Outcome = { ok: false; reason: 'bad_password' | 'gone' } | { ok: true; familyId: string; refreshToken: string };

/**
 * POST /auth/password (also the forced change of a temporary password). It
 * needs the current password, revokes every other device of the user and
 * rotates the current device's family: the response carries a new token pair.
 */
export class ChangePassword {
  constructor(
    private readonly uow: TenantUnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly codec: RefreshTokenCodec,
    private readonly accessTokens: AccessTokenService,
    private readonly clock: Clock,
  ) {}

  async execute(actor: AuthenticatedActor, command: ChangePasswordCommand): Promise<AuthTokens> {
    const now = this.clock.now();
    const outcome = await this.uow.run<Outcome>(actor.tenantId, async (scope) => {
      const user = await scope.users.findById(actor.userId);
      if (!user) return { ok: false, reason: 'gone' };
      if (!(await this.hasher.verify(user.passwordHash, command.currentPassword))) return { ok: false, reason: 'bad_password' };

      await scope.users.setPassword(user.id, await this.hasher.hash(command.newPassword));
      const others = await scope.devices.revokeAllExcept(user.id, actor.deviceId, now);
      await scope.refreshTokens.revokeByDevices(others, 'password_changed', now);
      await scope.refreshTokens.revokeFamily(actor.sessionId, 'password_changed', now);

      const refresh = this.codec.generate();
      const familyId = await scope.refreshTokens.startFamily({
        deviceId: actor.deviceId,
        tokenHash: refresh.hash,
        expiresAt: new Date(now.getTime() + AUTH_POLICY.refreshIdleTtlMs),
        absoluteExpiresAt: new Date(now.getTime() + AUTH_POLICY.refreshAbsoluteTtlMs),
        now,
      });
      await scope.audit.record({
        type: 'password_changed',
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
        metadata: { revokedDevices: others.length },
        ip: command.ip,
      });
      return { ok: true, familyId, refreshToken: refresh.token };
    });

    if (!outcome.ok) throw outcome.reason === 'gone' ? new InvalidSession() : new InvalidCurrentPassword();
    const access = await this.accessTokens.issue({ sub: actor.userId, tid: actor.tenantId, did: actor.deviceId, sid: outcome.familyId });
    return {
      accessToken: access.token,
      refreshToken: outcome.refreshToken,
      expiresIn: access.expiresIn,
      deviceId: actor.deviceId,
      mustChangePassword: false,
    };
  }
}
