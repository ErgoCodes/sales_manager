import type { AuthenticatedActor } from '../domain/actor';
import type { Clock, TenantUnitOfWork } from '../domain/auth-ports';

/** POST /auth/logout: revokes the current session (refresh family). Its access token dies on the next request. */
export class Logout {
  constructor(
    private readonly uow: TenantUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(actor: AuthenticatedActor, ip: string | null): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(actor.tenantId, async (scope) => {
      await scope.refreshTokens.revokeFamily(actor.sessionId, 'logout', now);
      await scope.audit.record({
        type: 'session_revoked',
        actorUserId: actor.userId,
        targetType: 'device',
        targetId: actor.deviceId,
        metadata: { reason: 'logout' },
        ip,
      });
    });
  }
}
