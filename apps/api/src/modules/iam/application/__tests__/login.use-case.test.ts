import { beforeEach, describe, expect, it } from 'vitest';

import { InvalidCredentials } from '../../domain/auth-errors';
import { AUTH_POLICY } from '../../domain/auth-policy';
import { Login } from '../login.use-case';
import { FakeAccessTokens, FakeClock, FakeIam, fakeCodec, fakeHasher, fakeSecurityLog, TENANT } from './auth-fakes';

const PASSWORD = 'secret password';

describe('Login', () => {
  let iam: FakeIam;
  let tokens: FakeAccessTokens;
  let clock: FakeClock;
  let log: ReturnType<typeof fakeSecurityLog>;
  let login: Login;

  beforeEach(() => {
    iam = new FakeIam();
    tokens = new FakeAccessTokens();
    clock = new FakeClock();
    log = fakeSecurityLog();
    fakeHasher.dummyCalls = 0;
    login = new Login(iam, fakeHasher, iam, fakeCodec, tokens, log, clock);
  });

  it('creates a device and a session, audits the login and returns the tokens', async () => {
    const user = iam.addUser();
    const result = await login.execute({ email: user.email, password: PASSWORD, device: { label: 'Phone', platform: 'android' }, ip: '10.0.0.1' });

    expect(iam.devices).toMatchObject([{ id: result.deviceId, userId: user.id, label: 'Phone', platform: 'android' }]);
    const [token] = iam.tokens;
    expect(token).toMatchObject({ deviceId: result.deviceId, rotatedAt: null, revokedAt: null });
    expect(token!.expiresAt.getTime() - clock.current.getTime()).toBe(AUTH_POLICY.refreshIdleTtlMs);
    expect(token!.absoluteExpiresAt.getTime() - clock.current.getTime()).toBe(AUTH_POLICY.refreshAbsoluteTtlMs);
    expect(tokens.issued).toEqual([{ sub: user.id, tid: TENANT, did: result.deviceId, sid: token!.familyId }]);
    expect(result).toMatchObject({ accessToken: 'access-1', expiresIn: 600, mustChangePassword: false });
    expect(fakeCodec.hash(result.refreshToken)).toEqual(Buffer.from(token!.hash, 'hex'));
    expect(iam.audit).toEqual([
      { type: 'login_succeeded', actorUserId: user.id, targetType: 'device', targetId: result.deviceId, metadata: { deviceReused: false }, ip: '10.0.0.1' },
    ]);
  });

  it('defaults the device label and platform', async () => {
    const user = iam.addUser();
    await login.execute({ email: user.email, password: PASSWORD, ip: null });
    expect(iam.devices).toMatchObject([{ label: 'Unknown device', platform: 'web' }]);
  });

  it('reuses an active device of the same user and supersedes its previous session', async () => {
    const user = iam.addUser();
    const first = await login.execute({ email: user.email, password: PASSWORD, ip: null });
    clock.advance(1_000);
    const second = await login.execute({ email: user.email, password: PASSWORD, deviceId: first.deviceId, ip: null });

    expect(second.deviceId).toBe(first.deviceId);
    expect(iam.devices).toHaveLength(1);
    expect(iam.devices[0]!.lastSeenAt).toEqual(clock.now());
    expect(iam.tokens.map((t) => t.reason)).toEqual(['superseded', null]);
    expect(iam.audit.at(-1)!.metadata).toEqual({ deviceReused: true });
  });

  it('does not reuse a device of another user', async () => {
    const owner = iam.addUser({ email: 'owner@example.com' });
    const other = iam.addUser({ email: 'other@example.com' });
    const theirs = await login.execute({ email: other.email, password: PASSWORD, ip: null });
    const mine = await login.execute({ email: owner.email, password: PASSWORD, deviceId: theirs.deviceId, ip: null });
    expect(mine.deviceId).not.toBe(theirs.deviceId);
    expect(iam.tokens.every((t) => t.revokedAt === null)).toBe(true);
  });

  it('reports a pending password change', async () => {
    const user = iam.addUser({ mustChangePassword: true, passwordExpiresAt: new Date(Date.parse('2026-11-08T12:00:00Z')) });
    expect((await login.execute({ email: user.email, password: PASSWORD, ip: null })).mustChangePassword).toBe(true);
  });

  it('pays the dummy hash for an unknown email and logs it without a tenant', async () => {
    await expect(login.execute({ email: 'ghost@example.com', password: PASSWORD, ip: '10.0.0.9' })).rejects.toBeInstanceOf(InvalidCredentials);
    expect(fakeHasher.dummyCalls).toBe(1);
    expect(log.unknown).toEqual(['10.0.0.9']);
    expect(iam.runs).toEqual([]);
  });

  it.each([
    ['bad_password', {}, 'wrong password'],
    ['disabled', { status: 'disabled' as const }, PASSWORD],
    ['temporary_password_expired', { mustChangePassword: true, passwordExpiresAt: new Date('2026-11-05T11:59:59Z') }, PASSWORD],
  ])('fails with the same error for %s and commits the audit event', async (reason, overrides, password) => {
    const user = iam.addUser(overrides);
    await expect(login.execute({ email: user.email, password, ip: '10.0.0.2' })).rejects.toBeInstanceOf(InvalidCredentials);
    expect(iam.audit).toEqual([{ type: 'login_failed', actorUserId: null, targetType: 'user', targetId: user.id, metadata: { reason }, ip: '10.0.0.2' }]);
    expect(iam.devices).toEqual([]);
    expect(tokens.issued).toEqual([]);
  });

  it('fails if the user vanished between the lookup and the transaction', async () => {
    const user = iam.addUser();
    const lookup = { findUserByEmail: async () => ({ id: user.id, tenantId: TENANT, passwordHash: user.passwordHash, status: 'active' }), findRefreshTenant: async () => null };
    iam.users.clear();
    const racing = new Login(lookup, fakeHasher, iam, fakeCodec, tokens, log, clock);
    await expect(racing.execute({ email: user.email, password: PASSWORD, ip: null })).rejects.toBeInstanceOf(InvalidCredentials);
    expect(iam.audit[0]!.metadata).toEqual({ reason: 'disabled' });
  });
});
