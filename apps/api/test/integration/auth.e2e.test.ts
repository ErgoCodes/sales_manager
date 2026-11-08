import { AuthTokens, ErrorResponse, MeResponse, RefreshResponse } from '@monaco/contracts';
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { RATE_LIMITS } from '../../src/infrastructure/rate-limit/rate-limit.module';
import { RequirePermission } from '../../src/modules/iam/http/auth.decorators';
import { AUTH_TENANT_A, AUTH_TENANT_B, type AuthSeed, createAuthApp, freshIp, PASSWORD, seedAuth, signedIpHeader } from './auth-fixtures';
import { adminPool, resetTenants } from './helpers';

/** Authenticated routes that are not on the must_change_password allow-list, for the guard tests. */
@Controller('probe')
class ProbeController {
  @Get()
  get() {
    return { ok: true };
  }

  @Get('users-admin')
  @RequirePermission('users:manage')
  admin() {
    return { ok: true };
  }
}

let app: NestExpressApplication;
let admin: Pool;
let seed: AuthSeed;

const http = () => request(app.getHttpServer());

/** POST through the "BFF": always with a fresh signed client IP unless one is given. */
function post(path: string, body: object, options: { ip?: string; token?: string } = {}) {
  const ip = options.ip ?? freshIp();
  const req = http().post(path).set(CLIENT_IP_HEADER, signedIpHeader('POST', path, ip)).send(body);
  return options.token ? req.set('authorization', `Bearer ${options.token}`) : req;
}
const get = (path: string, token: string) => http().get(path).set('authorization', `Bearer ${token}`);

async function login(email: string, extra: object = {}, ip?: string): Promise<AuthTokens> {
  const res = await post('/auth/login', { email, password: PASSWORD, ...extra }, { ip }).expect(200);
  return AuthTokens.parse(res.body);
}

async function auditTypes(): Promise<string[]> {
  const { rows } = await admin.query<{ type: string }>('select type from audit_events order by created_at, id');
  return rows.map((row) => row.type);
}

beforeAll(async () => {
  admin = adminPool();
  app = await createAuthApp([ProbeController]);
});
afterAll(async () => {
  await app.close();
  await resetTenants(admin);
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
  await admin.query('truncate table rate_limits');
  seed = await seedAuth(admin);
});

describe('POST /auth/login', () => {
  it('returns tokens and a device; GET /me shows the user, tenant and effective permissions', async () => {
    const ip = freshIp();
    const tokens = await login(seed.cashier.email, { device: { label: 'Chrome on Linux', platform: 'web' } }, ip);
    expect(tokens).toMatchObject({ expiresIn: 600, mustChangePassword: false });

    const me = MeResponse.parse((await get('/me', tokens.accessToken).expect(200)).body);
    expect(me).toEqual({
      user: { id: seed.cashier.id, email: seed.cashier.email, displayName: 'cashier', mustChangePassword: false },
      tenant: { id: AUTH_TENANT_A, name: 'Tenant A', slug: 'tenant-a' },
      deviceId: tokens.deviceId,
      permissions: [{ permission: 'sales:create', scope: { type: 'locations', locationIds: [seed.location] } }],
    });

    const { rows } = await admin.query(`select type, actor_user_id, target_id, host(ip) as ip from audit_events`);
    expect(rows).toEqual([{ type: 'login_succeeded', actor_user_id: seed.cashier.id, target_id: tokens.deviceId, ip }]);
    const { rows: devices } = await admin.query(`select label, platform, user_id from devices`);
    expect(devices).toEqual([{ label: 'Chrome on Linux', platform: 'web', user_id: seed.cashier.id }]);
  });

  it('reuses a known device of the same user and supersedes its previous session', async () => {
    const first = await login(seed.owner.email);
    const second = await login(seed.owner.email, { deviceId: first.deviceId });
    expect(second.deviceId).toBe(first.deviceId);
    await post('/auth/refresh', { refreshToken: first.refreshToken }).expect(401);
    await get('/me', first.accessToken).expect(401);
    await get('/me', second.accessToken).expect(200);
  });

  it('never reuses a device of another user (or a revoked one): it creates a new one', async () => {
    const cashier = await login(seed.cashier.email);
    const owner = await login(seed.owner.email, { deviceId: cashier.deviceId });
    expect(owner.deviceId).not.toBe(cashier.deviceId);
    await get('/me', cashier.accessToken).expect(200);

    await admin.query(`update devices set revoked_at = now() where id = $1`, [owner.deviceId]);
    expect((await login(seed.owner.email, { deviceId: owner.deviceId })).deviceId).not.toBe(owner.deviceId);
  });

  it('answers every failure with the same 401 and audits only real users', async () => {
    const wrong = await post('/auth/login', { email: seed.owner.email, password: 'wrong password!!' }).expect(401);
    const unknown = await post('/auth/login', { email: 'nobody@a.example', password: PASSWORD }).expect(401);
    await admin.query(`update users set status = 'disabled' where id = $1`, [seed.cashier.id]);
    const disabled = await post('/auth/login', { email: seed.cashier.email, password: PASSWORD }).expect(401);

    const expected = { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } };
    for (const res of [wrong, unknown, disabled]) expect(ErrorResponse.parse(res.body)).toEqual(expected);
    const { rows } = await admin.query(`select type, actor_user_id, target_id, metadata from audit_events order by target_id`);
    expect(rows).toEqual(
      expect.arrayContaining([
        { type: 'login_failed', actor_user_id: null, target_id: seed.owner.id, metadata: { reason: 'bad_password' } },
        { type: 'login_failed', actor_user_id: null, target_id: seed.cashier.id, metadata: { reason: 'disabled' } },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('rejects an expired temporary password', async () => {
    await admin.query(`update users set must_change_password = true, password_expires_at = now() - interval '1 second' where id = $1`, [
      seed.cashier.id,
    ]);
    await post('/auth/login', { email: seed.cashier.email, password: PASSWORD }).expect(401);
    expect(await auditTypes()).toEqual(['login_failed']);
  });

  it('takes about as long for an unknown email as for a wrong password (wide tolerance)', async () => {
    const time = async (email: string) => {
      const start = performance.now();
      await post('/auth/login', { email, password: 'definitely wrong' }).expect(401);
      return performance.now() - start;
    };
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    await time('warmup@a.example');
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 5; i++) {
      unknown.push(await time(`ghost-${i}@nowhere.example`));
      wrong.push(await time(seed.owner.email));
    }
    const ratio = median(unknown) / median(wrong);
    // Both pay one argon2id verification (~tens of ms); without the dummy hash the ratio would be ~0.05.
    expect(ratio).toBeGreaterThan(0.33);
    expect(ratio).toBeLessThan(3);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token; the previous one only gets an access token within the grace window', async () => {
    const tokens = await login(seed.owner.email);
    const rotated = RefreshResponse.parse((await post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(200)).body);
    expect(rotated.refreshToken).toBeDefined();
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    await get('/me', rotated.accessToken).expect(200);

    const grace = RefreshResponse.parse((await post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(200)).body);
    expect(grace.refreshToken).toBeUndefined();
    await get('/me', grace.accessToken).expect(200);

    // The new refresh token still works (the grace hit did not rotate anything).
    const next = RefreshResponse.parse((await post('/auth/refresh', { refreshToken: rotated.refreshToken! }).expect(200)).body);
    expect(next.refreshToken).toBeDefined();
    expect(await auditTypes()).toEqual(['login_succeeded']);
  });

  it('serializes concurrent refreshes of one token: one rotation, the other served from the grace window', async () => {
    const tokens = await login(seed.owner.email);
    const results = await Promise.all([1, 2].map(() => post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(200)));
    const bodies = results.map((res) => RefreshResponse.parse(res.body));
    expect(bodies.filter((body) => body.refreshToken !== undefined)).toHaveLength(1);
  });

  it('treats reuse after the grace window as theft: revokes the family (committed before the 401) and audits it', async () => {
    const tokens = await login(seed.owner.email);
    const rotated = RefreshResponse.parse((await post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(200)).body);
    await admin.query(`update refresh_tokens set rotated_at = rotated_at - interval '11 seconds' where rotated_at is not null`);

    const reuse = await post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(401);
    expect(ErrorResponse.parse(reuse.body).error.message).toBe('Invalid or expired session');
    await post('/auth/refresh', { refreshToken: rotated.refreshToken! }).expect(401);
    await get('/me', rotated.accessToken).expect(401);

    const { rows } = await admin.query(`select distinct revoked_reason from refresh_tokens`);
    expect(rows).toEqual([{ revoked_reason: 'reuse_detected' }]);
    expect(await auditTypes()).toEqual(['login_succeeded', 'refresh_reuse_detected']);
  });

  it('rejects unknown, expired and disabled-user tokens', async () => {
    await post('/auth/refresh', { refreshToken: 'not-a-token' }).expect(401);
    const tokens = await login(seed.owner.email);
    await admin.query(`update refresh_tokens set expires_at = now() - interval '1 second'`);
    await post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(401);

    const fresh = await login(seed.cashier.email);
    await admin.query(`update users set status = 'disabled' where id = $1`, [seed.cashier.id]);
    await post('/auth/refresh', { refreshToken: fresh.refreshToken }).expect(401);
  });
});

describe('immediate revocation (per-request check)', () => {
  it('logout revokes the session: the live access token gets 401 on the next request', async () => {
    const tokens = await login(seed.owner.email);
    await post('/auth/logout', {}, { token: tokens.accessToken }).expect(204);
    expect(ErrorResponse.parse((await get('/me', tokens.accessToken).expect(401)).body).error.message).toBe('Invalid or expired token');
    await post('/auth/refresh', { refreshToken: tokens.refreshToken }).expect(401);
    expect(await auditTypes()).toEqual(['login_succeeded', 'session_revoked']);
  });

  it('disabling the user or revoking the device cuts access at once', async () => {
    const owner = await login(seed.owner.email);
    const cashier = await login(seed.cashier.email);
    await get('/me', owner.accessToken).expect(200);
    await get('/me', cashier.accessToken).expect(200);

    await admin.query(`update users set status = 'disabled' where id = $1`, [seed.owner.id]);
    await admin.query(`update devices set revoked_at = now() where id = $1`, [cashier.deviceId]);
    await get('/me', owner.accessToken).expect(401);
    await get('/me', cashier.accessToken).expect(401);
  });

  it('rejects tampered tokens and tokens whose claims point at another tenant', async () => {
    const tokens = await login(seed.owner.email);
    const [header, payload, signature] = tokens.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, tid: AUTH_TENANT_B })).toString('base64url');
    await get('/me', `${header}.${forged}.${signature}`).expect(401);
  });
});

describe('authorization in the guard', () => {
  it('@RequirePermission is a coarse 403 for actors without the permission', async () => {
    const owner = await login(seed.owner.email);
    const cashier = await login(seed.cashier.email);
    await get('/probe/users-admin', owner.accessToken).expect(200);
    const res = await get('/probe/users-admin', cashier.accessToken).expect(403);
    expect(ErrorResponse.parse(res.body).error).toEqual({ code: 'FORBIDDEN', message: 'Forbidden' });
  });
});

describe('must_change_password', () => {
  beforeEach(async () => {
    await admin.query(`update users set must_change_password = true, password_expires_at = now() + interval '72 hours' where id = $1`, [
      seed.cashier.id,
    ]);
  });

  it('blocks everything but /me, logout and the password change; changing it rotates the session and frees the user', async () => {
    const other = await login(seed.cashier.email);
    const tokens = await login(seed.cashier.email);
    expect(tokens.mustChangePassword).toBe(true);

    const blocked = await get('/probe', tokens.accessToken).expect(403);
    expect(ErrorResponse.parse(blocked.body).error).toEqual({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required' });
    expect(MeResponse.parse((await get('/me', tokens.accessToken).expect(200)).body).user.mustChangePassword).toBe(true);

    const wrong = await post('/auth/password', { currentPassword: 'not the password', newPassword: 'a brand new password' }, { token: tokens.accessToken }).expect(400);
    expect(ErrorResponse.parse(wrong.body).error.code).toBe('INVALID_CURRENT_PASSWORD');

    const changed = AuthTokens.parse(
      (await post('/auth/password', { currentPassword: PASSWORD, newPassword: 'a brand new password' }, { token: tokens.accessToken }).expect(200)).body,
    );
    expect(changed).toMatchObject({ deviceId: tokens.deviceId, mustChangePassword: false });
    await get('/probe', changed.accessToken).expect(200);
    // The old session of this device and every other device are gone.
    await get('/me', tokens.accessToken).expect(401);
    await get('/me', other.accessToken).expect(401);
    await post('/auth/refresh', { refreshToken: other.refreshToken }).expect(401);
    await post('/auth/refresh', { refreshToken: changed.refreshToken }).expect(200);

    await post('/auth/login', { email: seed.cashier.email, password: PASSWORD }).expect(401);
    await post('/auth/login', { email: seed.cashier.email, password: 'a brand new password' }).expect(200);
    expect(await auditTypes()).toContain('password_changed');
  });
});

describe('rate limiting', () => {
  it('limits (IP, email) with backoff, without locking the email from other IPs', async () => {
    const ip = freshIp();
    for (let i = 0; i < RATE_LIMITS.credential.limit; i++) {
      await post('/auth/login', { email: seed.owner.email, password: 'wrong password!!' }, { ip }).expect(401);
    }
    const limited = await post('/auth/login', { email: seed.owner.email, password: PASSWORD }, { ip }).expect(429);
    expect(ErrorResponse.parse(limited.body).error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(limited.headers['retry-after-credential'])).toBeGreaterThan(0);

    // Same email from another IP: still allowed (no hard lock per email).
    await post('/auth/login', { email: seed.owner.email, password: PASSWORD }).expect(200);
  });

  it('limits per IP across emails', async () => {
    const ip = freshIp();
    for (let i = 0; i < RATE_LIMITS.ip.limit; i++) {
      await post('/auth/login', { email: `nobody-${i}@a.example`, password: 'wrong password!!' }, { ip }).expect(401);
    }
    await post('/auth/login', { email: 'nobody-last@a.example', password: 'wrong password!!' }, { ip }).expect(429);
  });

  it('ignores X-Forwarded-For and unsigned, badly signed or stale client IP headers', async () => {
    const forgedHeaders = (i: number) => ({
      'x-forwarded-for': `203.0.113.${i}`,
      [CLIENT_IP_HEADER]: [
        `v1;203.0.113.${i};${Math.floor(Date.now() / 1000)};AAAA`,
        signedIpHeader('POST', '/auth/login', `203.0.113.${i}`, Math.floor(Date.now() / 1000) - 120),
        signedIpHeader('POST', '/auth/refresh', `203.0.113.${i}`),
        signedIpHeader('POST', '/auth/login', `203.0.113.${i}`, undefined, 'a-different-secret-of-32-characters!!'),
        `203.0.113.${i}`,
      ][i % 5]!,
    });
    // Each attempt claims another IP, but none is trusted: all count against the socket address.
    for (let i = 0; i < RATE_LIMITS.credential.limit; i++) {
      await http().post('/auth/login').set(forgedHeaders(i)).send({ email: seed.owner.email, password: 'wrong password!!' }).expect(401);
    }
    await http().post('/auth/login').set(forgedHeaders(99)).send({ email: seed.owner.email, password: PASSWORD }).expect(429);

    const { rows } = await admin.query<{ ip: string }>(`select distinct host(ip) as ip from audit_events`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
  });
});
