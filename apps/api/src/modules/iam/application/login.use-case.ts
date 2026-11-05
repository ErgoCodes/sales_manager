import type { AuthTokens, DeviceInfo } from '@monaco/contracts';

import { InvalidCredentials } from '../domain/auth-errors';
import { AUTH_POLICY } from '../domain/auth-policy';
import type {
  AccessTokenService,
  Clock,
  PasswordHasher,
  PreAuthLookup,
  RefreshTokenCodec,
  SecurityLog,
  TenantUnitOfWork,
} from '../domain/auth-ports';

export interface LoginCommand {
  readonly email: string;
  readonly password: string;
  readonly deviceId?: string;
  readonly device?: DeviceInfo;
  readonly ip: string | null;
}

const DEFAULT_DEVICE: DeviceInfo = { label: 'Unknown device', platform: 'web' };

type Outcome = { ok: false } | { ok: true; userId: string; deviceId: string; familyId: string; refreshToken: string; mustChangePassword: boolean };

/**
 * POST /auth/login. Every failure looks the same to the caller (anti
 * enumeration): an unknown email still pays an argon2 verification against a
 * dummy hash with the same parameters, and the `disabled` state is evaluated
 * only after the hash. Failures of a real user are audited (committed before
 * the error); unknown emails go to the structured log, since they have no tenant.
 */
export class Login {
  constructor(
    private readonly lookup: PreAuthLookup,
    private readonly hasher: PasswordHasher,
    private readonly uow: TenantUnitOfWork,
    private readonly refreshTokens: RefreshTokenCodec,
    private readonly accessTokens: AccessTokenService,
    private readonly securityLog: SecurityLog,
    private readonly clock: Clock,
  ) {}

  async execute(command: LoginCommand): Promise<AuthTokens> {
    const found = await this.lookup.findUserByEmail(command.email);
    if (!found) {
      await this.hasher.verifyDummy(command.password);
      this.securityLog.loginWithUnknownEmail({ ip: command.ip });
      throw new InvalidCredentials();
    }
    const passwordOk = await this.hasher.verify(found.passwordHash, command.password);
    const now = this.clock.now();

    const outcome = await this.uow.run<Outcome>(found.tenantId, async (scope) => {
      const user = await scope.users.findById(found.id);
      const reason = !passwordOk
        ? 'bad_password'
        : !user || user.status !== 'active'
          ? 'disabled'
          : user.mustChangePassword && user.passwordExpiresAt !== null && user.passwordExpiresAt <= now
            ? 'temporary_password_expired'
            : null;
      if (reason !== null || !user) {
        await scope.audit.record({ type: 'login_failed', actorUserId: null, targetType: 'user', targetId: found.id, metadata: { reason }, ip: command.ip });
        return { ok: false };
      }

      const reused = command.deviceId ? await scope.devices.findActive(command.deviceId, user.id) : null;
      let deviceId: string;
      if (reused) {
        deviceId = reused.id;
        // One live session per device: a new login replaces the previous family.
        await scope.refreshTokens.revokeByDevices([deviceId], 'superseded', now);
        await scope.devices.touch(deviceId, now);
      } else {
        const device = command.device ?? DEFAULT_DEVICE;
        deviceId = await scope.devices.create({ userId: user.id, label: device.label, platform: device.platform, now });
      }

      const refresh = this.refreshTokens.generate();
      const familyId = await scope.refreshTokens.startFamily({
        deviceId,
        tokenHash: refresh.hash,
        expiresAt: new Date(now.getTime() + AUTH_POLICY.refreshIdleTtlMs),
        absoluteExpiresAt: new Date(now.getTime() + AUTH_POLICY.refreshAbsoluteTtlMs),
        now,
      });
      await scope.audit.record({
        type: 'login_succeeded',
        actorUserId: user.id,
        targetType: 'device',
        targetId: deviceId,
        metadata: { deviceReused: reused !== null },
        ip: command.ip,
      });
      return { ok: true, userId: user.id, deviceId, familyId, refreshToken: refresh.token, mustChangePassword: user.mustChangePassword };
    });

    if (!outcome.ok) throw new InvalidCredentials();
    const access = await this.accessTokens.issue({ sub: outcome.userId, tid: found.tenantId, did: outcome.deviceId, sid: outcome.familyId });
    return {
      accessToken: access.token,
      refreshToken: outcome.refreshToken,
      expiresIn: access.expiresIn,
      deviceId: outcome.deviceId,
      mustChangePassword: outcome.mustChangePassword,
    };
  }
}
