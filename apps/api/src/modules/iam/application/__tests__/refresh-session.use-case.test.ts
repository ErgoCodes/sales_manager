import { beforeEach, describe, expect, it } from 'vitest';

import { InvalidSession } from '../../domain/auth-errors';
import { AUTH_POLICY } from '../../domain/auth-policy';
import { Login } from '../login.use-case';
import { RefreshSession } from '../refresh-session.use-case';
import { FakeAccessTokens, FakeClock, FakeIam, fakeCodec, fakeHasher, fakeSecurityLog } from './auth-fakes';

describe('RefreshSession', () => {
  let iam: FakeIam;
  let tokens: FakeAccessTokens;
  let clock: FakeClock;
  let refresh: RefreshSession;
  let session: { refreshToken: string; deviceId: string; userId: string };

  beforeEach(async () => {
    iam = new FakeIam();
    tokens = new FakeAccessTokens();
    clock = new FakeClock();
    refresh = new RefreshSession(iam, iam, fakeCodec, tokens, clock);
    const user = iam.addUser();
    const result = await new Login(iam, fakeHasher, iam, fakeCodec, tokens, fakeSecurityLog(), clock).execute({
      email: user.email,
      password: 'secret password',
      ip: null,
    });
    session = { refreshToken: result.refreshToken, deviceId: result.deviceId, userId: user.id };
    iam.audit = [];
  });

  it('rotates: marks the token, appends the next one to the family and touches the device', async () => {
    clock.advance(60_000);
    const result = await refresh.execute({ refreshToken: session.refreshToken, ip: null });
    expect(result.refreshToken).toBeDefined();
    const [old, next] = iam.tokens;
    expect(old!.rotatedAt).toEqual(clock.now());
    expect(next).toMatchObject({ familyId: old!.familyId, deviceId: session.deviceId, rotatedAt: null, absoluteExpiresAt: old!.absoluteExpiresAt });
    expect(next!.expiresAt.getTime()).toBe(clock.current.getTime() + AUTH_POLICY.refreshIdleTtlMs);
    expect(iam.devices[0]!.lastSeenAt).toEqual(clock.now());
    expect(tokens.issued.at(-1)).toMatchObject({ sid: old!.familyId, did: session.deviceId, sub: session.userId });
  });

  it('never extends a token past the absolute expiry of its family', async () => {
    clock.advance(AUTH_POLICY.refreshAbsoluteTtlMs - 1_000);
    iam.tokens[0]!.expiresAt = new Date(clock.current.getTime() + 1_000);
    await refresh.execute({ refreshToken: session.refreshToken, ip: null });
    expect(iam.tokens[1]!.expiresAt).toEqual(iam.tokens[0]!.absoluteExpiresAt);
  });

  it('within the grace window gives the old token an access token only', async () => {
    await refresh.execute({ refreshToken: session.refreshToken, ip: null });
    clock.advance(AUTH_POLICY.refreshGraceMs);
    const grace = await refresh.execute({ refreshToken: session.refreshToken, ip: null });
    expect(grace).toEqual({ accessToken: expect.any(String), expiresIn: 600 });
    expect(iam.tokens).toHaveLength(2);
    expect(iam.tokens.every((t) => t.revokedAt === null)).toBe(true);
  });

  it('after the grace window treats it as reuse: revokes the whole family, audits, commits, then fails', async () => {
    const rotated = await refresh.execute({ refreshToken: session.refreshToken, ip: null });
    clock.advance(AUTH_POLICY.refreshGraceMs + 1);
    await expect(refresh.execute({ refreshToken: session.refreshToken, ip: '10.1.1.1' })).rejects.toBeInstanceOf(InvalidSession);
    expect(iam.tokens.map((t) => t.reason)).toEqual(['reuse_detected', 'reuse_detected']);
    expect(iam.audit).toEqual([
      {
        type: 'refresh_reuse_detected',
        actorUserId: session.userId,
        targetType: 'device',
        targetId: session.deviceId,
        metadata: { sessionId: iam.tokens[0]!.familyId },
        ip: '10.1.1.1',
      },
    ]);
    await expect(refresh.execute({ refreshToken: rotated.refreshToken!, ip: null })).rejects.toBeInstanceOf(InvalidSession);
  });

  it.each([
    ['unknown', () => 'nope'],
  ])('rejects an %s token', async (_label, token) => {
    await expect(refresh.execute({ refreshToken: token(), ip: null })).rejects.toBeInstanceOf(InvalidSession);
  });

  it.each([
    ['revoked', (iam: FakeIam) => (iam.tokens[0]!.revokedAt = new Date())],
    ['idle-expired', (iam: FakeIam, now: Date) => (iam.tokens[0]!.expiresAt = now)],
    ['past its absolute expiry', (iam: FakeIam, now: Date) => (iam.tokens[0]!.absoluteExpiresAt = now)],
    ['on a revoked device', (iam: FakeIam) => (iam.devices[0]!.revokedAt = new Date())],
    ['of a disabled user', (iam: FakeIam) => iam.users.forEach((u, id) => iam.users.set(id, { ...u, status: 'disabled' }))],
  ])('rejects a token %s without changing anything', async (_label, mutate) => {
    mutate(iam, clock.now());
    const before = structuredClone(iam.tokens);
    await expect(refresh.execute({ refreshToken: session.refreshToken, ip: null })).rejects.toBeInstanceOf(InvalidSession);
    expect(iam.tokens).toEqual(before);
    expect(iam.audit).toEqual([]);
  });

  it('rejects a token whose row disappeared after the lookup', async () => {
    const lookup = { findUserByEmail: async () => null, findRefreshTenant: async () => ({ tenantId: 'x' }) };
    const racing = new RefreshSession(lookup, iam, fakeCodec, tokens, clock);
    await expect(racing.execute({ refreshToken: 'gone', ip: null })).rejects.toBeInstanceOf(InvalidSession);
  });
});
