import { beforeEach, describe, expect, it } from 'vitest';

import type { AuthenticatedActor } from '../../domain/actor';
import { InvalidCurrentPassword, InvalidSession } from '../../domain/auth-errors';
import { effectivePermissions } from '../../domain/permissions';
import { Authenticate, toAssignments } from '../authenticate.use-case';
import { ChangePassword } from '../change-password.use-case';
import { GetMe } from '../get-me.use-case';
import { Login } from '../login.use-case';
import { Logout } from '../logout.use-case';
import { FakeAccessTokens, FakeClock, FakeIam, fakeCodec, fakeHasher, fakeSecurityLog, TENANT } from './auth-fakes';

const LOCATION = '0190a000-0000-7000-8000-0000000000aa';

describe('session use cases', () => {
  let iam: FakeIam;
  let tokens: FakeAccessTokens;
  let clock: FakeClock;
  let actor: AuthenticatedActor;
  let accessToken: string;

  beforeEach(async () => {
    iam = new FakeIam();
    tokens = new FakeAccessTokens();
    clock = new FakeClock();
    const user = iam.addUser({ mustChangePassword: true });
    const login = new Login(iam, fakeHasher, iam, fakeCodec, tokens, fakeSecurityLog(), clock);
    const result = await login.execute({ email: user.email, password: 'secret password', ip: null });
    accessToken = result.accessToken;
    const claims = tokens.valid.get(accessToken)!;
    actor = {
      userId: user.id,
      tenantId: TENANT,
      deviceId: result.deviceId,
      sessionId: claims.sid,
      mustChangePassword: true,
      assignments: [],
      effective: effectivePermissions([]),
    };
    iam.audit = [];
  });

  describe('Authenticate', () => {
    const state = {
      userActive: true,
      mustChangePassword: false,
      deviceActive: true,
      sessionActive: true,
      assignments: [
        { roleId: 'r1', roleKey: 'cashier' as const, isSystem: true, permissions: ['sales:create' as const], scope: 'locations' as const, locationIds: [LOCATION] },
        { roleId: 'r2', roleKey: null, isSystem: false, permissions: ['reports:view' as const], scope: 'tenant' as const, locationIds: [] },
      ],
    };

    it('resolves the actor and its effective permissions from one read in the token tenant', async () => {
      iam.actorState = state;
      const resolved = await new Authenticate(tokens, iam).execute(accessToken);
      expect(resolved).toMatchObject({ userId: actor.userId, tenantId: TENANT, deviceId: actor.deviceId, sessionId: actor.sessionId, mustChangePassword: false });
      expect(resolved!.effective.tenantWide).toEqual(new Set(['reports:view']));
      expect(resolved!.effective.byLocation.get(LOCATION)).toEqual(new Set(['sales:create']));
      expect(iam.runs.at(-1)).toBe(TENANT);
    });

    it.each([
      ['an invalid token', null, 'bad-token'],
      ['an unknown user or device', null, undefined],
      ['a disabled user', { ...state, userActive: false }, undefined],
      ['a revoked device', { ...state, deviceActive: false }, undefined],
      ['a revoked session', { ...state, sessionActive: false }, undefined],
    ])('rejects %s', async (_label, actorState, token) => {
      iam.actorState = actorState;
      expect(await new Authenticate(tokens, iam).execute(token ?? accessToken)).toBeNull();
    });

    it('maps stored assignments to domain assignments', () => {
      expect(toAssignments(state.assignments)).toEqual([
        { role: { id: 'r1', key: 'cashier', isSystem: true, permissions: ['sales:create'] }, scope: { type: 'locations', locationIds: [LOCATION] } },
        { role: { id: 'r2', key: null, isSystem: false, permissions: ['reports:view'] }, scope: { type: 'tenant' } },
      ]);
    });
  });

  describe('Logout', () => {
    it('revokes the current family and audits it', async () => {
      await new Logout(iam, clock).execute(actor, '10.0.0.3');
      expect(iam.tokens.map((t) => t.reason)).toEqual(['logout']);
      expect(iam.audit).toEqual([
        { type: 'session_revoked', actorUserId: actor.userId, targetType: 'device', targetId: actor.deviceId, metadata: { reason: 'logout' }, ip: '10.0.0.3' },
      ]);
    });
  });

  describe('ChangePassword', () => {
    const change = () => new ChangePassword(iam, fakeHasher, fakeCodec, tokens, clock);

    it('sets the password, revokes other devices and rotates the current session', async () => {
      const otherDevice = await iam.run(TENANT, (scope) => scope.devices.create({ userId: actor.userId, label: 'Old', platform: 'web', now: clock.now() }));
      await iam.run(TENANT, (scope) =>
        scope.refreshTokens.startFamily({ deviceId: otherDevice, tokenHash: fakeCodec.hash('other'), expiresAt: clock.now(), absoluteExpiresAt: clock.now(), now: clock.now() }),
      );

      const result = await change().execute(actor, { currentPassword: 'secret password', newPassword: 'new long password', ip: null });

      const user = iam.users.get(actor.userId)!;
      expect(user).toMatchObject({ passwordHash: 'hash:new long password', mustChangePassword: false, passwordExpiresAt: null });
      expect(iam.devices.find((d) => d.id === otherDevice)!.revokedAt).toEqual(clock.now());
      expect(iam.devices.find((d) => d.id === actor.deviceId)!.revokedAt).toBeNull();
      expect(iam.tokens.map((t) => t.reason)).toEqual(['password_changed', 'password_changed', null]);
      const live = iam.tokens[2]!;
      expect(live.deviceId).toBe(actor.deviceId);
      expect(result).toMatchObject({ deviceId: actor.deviceId, mustChangePassword: false });
      expect(tokens.issued.at(-1)).toEqual({ sub: actor.userId, tid: TENANT, did: actor.deviceId, sid: live.familyId });
      expect(iam.audit).toMatchObject([{ type: 'password_changed', targetId: actor.userId, metadata: { revokedDevices: 1 } }]);
    });

    it('rejects a wrong current password without changing anything', async () => {
      await expect(change().execute(actor, { currentPassword: 'nope', newPassword: 'new long password', ip: null })).rejects.toBeInstanceOf(
        InvalidCurrentPassword,
      );
      expect(iam.users.get(actor.userId)!.passwordHash).toBe('hash:secret password');
      expect(iam.tokens.every((t) => t.revokedAt === null)).toBe(true);
    });

    it('fails as an invalid session if the user is gone', async () => {
      iam.users.clear();
      await expect(change().execute(actor, { currentPassword: 'secret password', newPassword: 'x'.repeat(12), ip: null })).rejects.toBeInstanceOf(
        InvalidSession,
      );
    });
  });

  describe('GetMe', () => {
    it('returns the user, tenant, device and grants', async () => {
      const assignments = toAssignments([
        { roleId: 'r1', roleKey: null, isSystem: false, permissions: ['sales:create'], scope: 'locations', locationIds: [LOCATION] },
        { roleId: 'r2', roleKey: null, isSystem: false, permissions: ['reports:view'], scope: 'tenant', locationIds: [] },
      ]);
      const me = await new GetMe(iam).execute({ ...actor, assignments, effective: effectivePermissions(assignments) });
      expect(me).toEqual({
        user: { id: actor.userId, email: 'user@example.com', displayName: 'User', mustChangePassword: true },
        tenant: { id: TENANT, name: 'Tenant', slug: 'tenant' },
        deviceId: actor.deviceId,
        permissions: [
          { permission: 'sales:create', scope: { type: 'locations', locationIds: [LOCATION] } },
          { permission: 'reports:view', scope: { type: 'tenant' } },
        ],
      });
    });

    it('fails as an invalid session if the user is gone', async () => {
      iam.users.clear();
      await expect(new GetMe(iam).execute(actor)).rejects.toBeInstanceOf(InvalidSession);
    });
  });
});
