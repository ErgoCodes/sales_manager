import type { RefreshResponse } from '@monaco/contracts';

import { InvalidSession } from '../domain/auth-errors';
import { AUTH_POLICY } from '../domain/auth-policy';
import type { AccessTokenClaims, AccessTokenService, Clock, PreAuthLookup, RefreshTokenCodec, TenantUnitOfWork } from '../domain/auth-ports';

export interface RefreshCommand {
  readonly refreshToken: string;
  readonly ip: string | null;
}

type Outcome =
  | { kind: 'invalid' }
  | { kind: 'reuse' }
  | { kind: 'grace'; claims: AccessTokenClaims }
  | { kind: 'rotated'; claims: AccessTokenClaims; refreshToken: string };

/**
 * POST /auth/refresh: rotating refresh tokens with reuse detection (OAuth 2.0
 * Security BCP; ADR 0004). The token row is locked (`FOR UPDATE`), so two
 * concurrent refreshes of the same token serialize:
 *
 * - not rotated yet: it is marked rotated and a new token of the same family is issued;
 * - rotated less than 10 s ago (grace window): only a new access token, never a
 *   refresh token, so a stolen token cannot obtain the live pair;
 * - rotated earlier: reuse. The whole family is revoked and audited, and that
 *   commits before the 401 (the unit of work returns an outcome instead of throwing).
 */
export class RefreshSession {
  constructor(
    private readonly lookup: PreAuthLookup,
    private readonly uow: TenantUnitOfWork,
    private readonly codec: RefreshTokenCodec,
    private readonly accessTokens: AccessTokenService,
    private readonly clock: Clock,
  ) {}

  async execute(command: RefreshCommand): Promise<RefreshResponse> {
    const hash = this.codec.hash(command.refreshToken);
    const found = await this.lookup.findRefreshTenant(hash);
    if (!found) throw new InvalidSession();
    const now = this.clock.now();

    const outcome = await this.uow.run<Outcome>(found.tenantId, async (scope) => {
      const row = await scope.refreshTokens.findForUpdate(hash);
      if (
        !row ||
        row.revokedAt !== null ||
        row.expiresAt <= now ||
        row.absoluteExpiresAt <= now ||
        row.deviceRevokedAt !== null ||
        row.userStatus !== 'active'
      ) {
        return { kind: 'invalid' };
      }
      const claims: AccessTokenClaims = { sub: row.userId, tid: found.tenantId, did: row.deviceId, sid: row.familyId };

      if (row.rotatedAt !== null) {
        if (now.getTime() - row.rotatedAt.getTime() <= AUTH_POLICY.refreshGraceMs) return { kind: 'grace', claims };
        await scope.refreshTokens.revokeFamily(row.familyId, 'reuse_detected', now);
        await scope.audit.record({
          type: 'refresh_reuse_detected',
          actorUserId: row.userId,
          targetType: 'device',
          targetId: row.deviceId,
          metadata: { sessionId: row.familyId },
          ip: command.ip,
        });
        return { kind: 'reuse' };
      }

      await scope.refreshTokens.markRotated(row.id, now);
      const next = this.codec.generate();
      await scope.refreshTokens.append(row.familyId, {
        deviceId: row.deviceId,
        tokenHash: next.hash,
        expiresAt: new Date(Math.min(now.getTime() + AUTH_POLICY.refreshIdleTtlMs, row.absoluteExpiresAt.getTime())),
        absoluteExpiresAt: row.absoluteExpiresAt,
        now,
      });
      await scope.devices.touch(row.deviceId, now);
      return { kind: 'rotated', claims, refreshToken: next.token };
    });

    if (outcome.kind === 'invalid' || outcome.kind === 'reuse') throw new InvalidSession();
    const access = await this.accessTokens.issue(outcome.claims);
    return outcome.kind === 'rotated'
      ? { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: outcome.refreshToken }
      : { accessToken: access.token, expiresIn: access.expiresIn };
  }
}
