import { CreateUserResponse, PaginatedUsers, ResetPasswordResponse, User, UserDetail } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { USER_CREATION_LIMIT } from '../../src/modules/users/http/users.controller';
import { auditRows, loginAs, raceOnTenantMutex, resetAll, type SeededTenant, Seeder } from './admin-fixtures';
import { createAuthApp, freshIp, PASSWORD, signedIpHeader } from './auth-fixtures';
import { adminPool } from './helpers';

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  admin = adminPool();
  seeder = new Seeder(admin);
  app = await createAuthApp();
});
afterAll(async () => {
  await app.close();
  await resetAll(admin);
  await admin.end();
});
beforeEach(async () => {
  await resetAll(admin);
  a = await seeder.tenant('a');
  b = await seeder.tenant('b');
});

const userRow = async (id: string) =>
  (
    await admin.query<{ status: string; display_name: string; must_change_password: boolean; password_expires_at: Date | null; password_hash: string }>(
      'select status, display_name, must_change_password, password_expires_at, password_hash from users where id = $1',
      [id],
    )
  ).rows[0];
const liveDevices = async (userId: string) =>
  (await admin.query('select 1 from devices where user_id = $1 and revoked_at is null', [userId])).rowCount;
const liveTokens = async (userId: string) =>
  (
    await admin.query(
      'select 1 from refresh_tokens r join devices d on d.id = r.device_id where d.user_id = $1 and r.revoked_at is null',
      [userId],
    )
  ).rowCount;
const tryLogin = (email: string, password = PASSWORD) => {
  const ip = freshIp();
  return request(app.getHttpServer()).post('/auth/login').set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', ip)).send({ email, password });
};

describe('POST /users', () => {
  it('creates a user with a server-generated temporary password valid for 72 h', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const before = Date.now();
    const res = CreateUserResponse.parse((await owner.post('/users', { email: 'new@a.example', displayName: 'Nuevo' }).expect(201)).body);
    expect(res.user).toMatchObject({ email: 'new@a.example', displayName: 'Nuevo', status: 'active', mustChangePassword: true });
    const expiresAt = new Date(res.temporaryPasswordExpiresAt).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(72 * 3600_000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(72 * 3600_000 + 60_000);

    const row = await userRow(res.user.id);
    expect(row).toMatchObject({ status: 'active', must_change_password: true });
    expect(row!.password_hash).not.toContain(res.temporaryPassword);
    const login = await tryLogin('new@a.example', res.temporaryPassword).expect(200);
    expect(login.body.mustChangePassword).toBe(true);

    const audit = (await auditRows(admin, a.id)).filter((r) => r.type === 'user_created');
    expect(audit).toEqual([expect.objectContaining({ actor_user_id: a.owner, target_id: res.user.id })]);
    expect(JSON.stringify(audit)).not.toContain(res.temporaryPassword);
  });

  it('an email that exists, in this or another tenant, gets the same generic 409 and an audit event', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const own = await owner.post('/users', { email: 'OWNER@a.example', displayName: 'X' }).expect(409);
    const other = await owner.post('/users', { email: 'owner@b.example', displayName: 'X' }).expect(409);
    expect(own.body).toEqual({ error: { code: 'CONFLICT', message: 'Could not create the user' } });
    expect(other.body).toEqual(own.body);
    const { rows } = await admin.query('select count(*)::int as n from users');
    expect(rows[0].n).toBe(2);
    const audit = (await auditRows(admin, a.id)).filter((r) => r.type === 'user_create_conflict');
    expect(audit.map((r) => r.actor_user_id)).toEqual([a.owner, a.owner]);
    expect(await auditRows(admin, b.id)).toEqual([]);
  });

  it('is rate limited per (IP, user)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    for (let i = 0; i < USER_CREATION_LIMIT.limit; i++) {
      await owner.post('/users', { email: `u${i}@a.example`, displayName: 'U' }).expect(201);
    }
    await owner.post('/users', { email: 'over@a.example', displayName: 'U' }).expect(429);
  });
});

describe('GET /users', () => {
  it('lists users and shows one with its assignments (users:manage)', async () => {
    const cashier = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const owner = await loginAs(app, 'owner@a.example');
    const page = PaginatedUsers.parse((await owner.get('/users').expect(200)).body);
    expect(page.items.map((u) => u.id)).toEqual([a.owner, cashier]);
    const detail = UserDetail.parse((await owner.get(`/users/${cashier}`).expect(200)).body);
    expect(detail.assignments).toEqual([{ id: expect.any(String), roleId: a.roles.cashier, scope: { type: 'locations', locationIds: [a.locations[0]] } }]);
    expect(JSON.stringify(page)).not.toContain('password');
  });
});

describe('PATCH /users/:id', () => {
  it('renames another user, or oneself', async () => {
    const cashier = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const owner = await loginAs(app, 'owner@a.example');
    expect(User.parse((await owner.patch(`/users/${cashier}`, { displayName: 'Caja 1' }).expect(200)).body).displayName).toBe('Caja 1');
    await owner.patch(`/users/${a.owner}`, { displayName: 'Dueña' }).expect(200);
    expect((await userRow(a.owner))!.display_name).toBe('Dueña');
    expect((await auditRows(admin, a.id)).filter((r) => r.type === 'user_updated').map((r) => r.target_id)).toEqual([cashier, a.owner]);
  });
});

describe('POST /users/:id/disable', () => {
  it('disables the user and revokes every session at once: the live access token gets 401', async () => {
    const cashier = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const session = await loginAs(app, 'cashier@a.example');
    await loginAs(app, 'cashier@a.example');
    await session.get('/locations').expect(200);

    const owner = await loginAs(app, 'owner@a.example');
    expect(User.parse((await owner.post(`/users/${cashier}/disable`).expect(200)).body).status).toBe('disabled');

    await session.get('/locations').expect(401);
    expect(await liveDevices(cashier)).toBe(0);
    expect(await liveTokens(cashier)).toBe(0);
    await tryLogin('cashier@a.example').expect(401);
    expect((await auditRows(admin, a.id)).filter((r) => r.type === 'user_disabled')).toEqual([
      expect.objectContaining({ actor_user_id: a.owner, target_id: cashier, metadata: { revokedDevices: 2 } }),
    ]);
  });

  it('nobody disables themselves (403)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    await owner.post(`/users/${a.owner}/disable`).expect(403);
    expect((await userRow(a.owner))!.status).toBe('active');
  });

  it('two Owners disabling each other at the same time: one wins, the other gets 409 (last owner)', async () => {
    const second = await seeder.user(a.id, 'owner2@a.example', [[a.roles.owner, 'tenant']]);
    const one = await loginAs(app, 'owner@a.example');
    const two = await loginAs(app, 'owner2@a.example');
    const results = await raceOnTenantMutex(admin, a.id, 2, () =>
      Promise.all([one.post(`/users/${second}/disable`), two.post(`/users/${a.owner}/disable`)]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('LAST_OWNER');
    const { rows } = await admin.query(`select count(*)::int as n from users where tenant_id = $1 and status = 'active'`, [a.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('POST /users/:id/reset-password', () => {
  it('replaces the password with a temporary one and revokes every session', async () => {
    const cashier = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const session = await loginAs(app, 'cashier@a.example');
    const owner = await loginAs(app, 'owner@a.example');
    const res = ResetPasswordResponse.parse((await owner.post(`/users/${cashier}/reset-password`).expect(200)).body);

    await session.get('/locations').expect(401);
    expect(await liveTokens(cashier)).toBe(0);
    await tryLogin('cashier@a.example').expect(401);
    expect((await tryLogin('cashier@a.example', res.temporaryPassword).expect(200)).body.mustChangePassword).toBe(true);
    expect((await userRow(cashier))!.password_expires_at!.getTime()).toBe(new Date(res.temporaryPasswordExpiresAt).getTime());
    expect((await auditRows(admin, a.id)).filter((r) => r.type === 'user_password_reset').map((r) => r.target_id)).toEqual([cashier]);
  });
});

describe('no escalation on user routes', () => {
  let usersAdmin: string;
  let manager: string;
  let cashier: string;
  beforeEach(async () => {
    // users:manage plus the Cashier permissions, tenant-wide (granted by an Owner).
    const role = await seeder.role(a.id, 'UsersAdmin', ['users:manage', 'sales:create', 'reports:view', 'cash:close']);
    usersAdmin = await seeder.user(a.id, 'useradmin@a.example', [[role, 'tenant']]);
    manager = await seeder.user(a.id, 'manager@a.example', [[a.roles.manager, [a.locations[0]]]]);
    cashier = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
  });

  it('may manage users it covers, never an Owner nor someone with more permissions', async () => {
    const ua = await loginAs(app, 'useradmin@a.example');
    await ua.post(`/users/${a.owner}/disable`).expect(403);
    await ua.post(`/users/${a.owner}/reset-password`).expect(403);
    await ua.patch(`/users/${a.owner}`, { displayName: 'X' }).expect(403);
    await ua.post(`/users/${manager}/reset-password`).expect(403);
    await ua.post(`/users/${manager}/disable`).expect(403);
    await ua.post(`/users/${usersAdmin}/reset-password`).expect(403);
    await ua.post(`/users/${cashier}/reset-password`).expect(200);
    expect((await userRow(a.owner))!.status).toBe('active');
    expect((await userRow(manager))!.status).toBe('active');
    const reasons = (await auditRows(admin, a.id)).filter((r) => r.type === 'escalation_denied').map((r) => r.metadata.reason);
    expect(reasons).toEqual(['owner_only', 'owner_only', 'owner_only', 'permission_not_held', 'permission_not_held', 'self_modification']);
  });

  it('a cashier gets 403 on every user route', async () => {
    const c = await loginAs(app, 'cashier@a.example');
    await c.get('/users').expect(403);
    await c.get(`/users/${cashier}`).expect(403);
    await c.post('/users', { email: 'x@a.example', displayName: 'X' }).expect(403);
    await c.patch(`/users/${cashier}`, { displayName: 'X' }).expect(403);
    await c.post(`/users/${manager}/disable`).expect(403);
    await c.post(`/users/${manager}/reset-password`).expect(403);
  });
});
