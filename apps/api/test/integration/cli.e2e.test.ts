import { AuthTokens, PERMISSIONS } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { Argon2PasswordHasher } from '../../src/modules/iam/infrastructure/argon2-password-hasher';
import { DEMO_USERS } from '../../src/scripts/demo-seed';
import { runSeed } from '../../src/scripts/seed';
import { runTenantCreate } from '../../src/scripts/tenant-create';
import { createAuthApp, freshIp, signedIpHeader } from './auth-fixtures';
import { adminPool, resetTenants, urls } from './helpers';

let admin: Pool;
const hasher = new Argon2PasswordHasher();

beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
});

const count = async (table: string): Promise<number> => Number((await admin.query(`select count(*)::int as n from ${table}`)).rows[0].n);

function capture() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

const OWNER_URL = () => ({ DATABASE_MIGRATION_URL: urls().owner });
const ARGS = ['--name', 'Acme Store', '--slug', 'acme', '--owner-email', 'boss@acme.example'];

describe('tenant:create', () => {
  it('creates the tenant, the three system roles and an owner with a temporary password printed once', async () => {
    const out = capture();
    await runTenantCreate(ARGS, OWNER_URL(), out.write);

    const printed = out.lines.filter((line) => line.includes('Temporary password:'));
    expect(printed).toHaveLength(1);
    const password = printed[0]!.split('Temporary password:')[1]!.trim();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(out.lines.filter((line) => line.includes(password))).toHaveLength(1);

    expect((await admin.query('select name, slug from tenants')).rows).toEqual([{ name: 'Acme Store', slug: 'acme' }]);
    const roles = await admin.query('select key, is_system, (select count(*)::int from role_permissions p where p.role_id = r.id) as permissions from roles r order by key');
    expect(roles.rows).toEqual([
      { key: 'cashier', is_system: true, permissions: 5 },
      { key: 'manager', is_system: true, permissions: 10 },
      { key: 'owner', is_system: true, permissions: PERMISSIONS.length },
    ]);

    const user = (await admin.query('select * from users')).rows[0];
    expect(user.email).toBe('boss@acme.example');
    expect(user.must_change_password).toBe(true);
    expect(user.status).toBe('active');
    const ttl = new Date(user.password_expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(71 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(72 * 3600_000);
    expect(await hasher.verify(user.password_hash, password)).toBe(true);

    const assignment = (await admin.query(`select a.scope, r.key from role_assignments a join roles r on r.id = a.role_id`)).rows;
    expect(assignment).toEqual([{ scope: 'tenant', key: 'owner' }]);
  });

  it('rolls everything back on a duplicate slug or owner email', async () => {
    await runTenantCreate(ARGS, OWNER_URL(), capture().write);
    await expect(runTenantCreate([...ARGS.slice(0, 5), 'other@acme.example'], OWNER_URL(), capture().write)).rejects.toThrow(/slug/i);
    await expect(runTenantCreate(['--name', 'B', '--slug', 'b', '--owner-email', 'boss@acme.example'], OWNER_URL(), capture().write)).rejects.toThrow(/email/i);
    expect(await count('tenants')).toBe(1);
    expect(await count('users')).toBe(1);
    expect(await count('roles')).toBe(3);
  });

  it.each([
    [['--slug', 'acme', '--owner-email', 'a@b.example'], /--name/],
    [['--name', 'A', '--owner-email', 'a@b.example'], /--slug/],
    [['--name', 'A', '--slug', 'acme'], /--owner-email/],
    [['--name', 'A', '--slug', 'Not A Slug', '--owner-email', 'a@b.example'], /slug/i],
    [['--name', 'A', '--slug', 'acme', '--owner-email', 'nope'], /email/i],
  ])('rejects invalid arguments %j without touching the database', async (args, message) => {
    const out = capture();
    await expect(runTenantCreate(args, OWNER_URL(), out.write)).rejects.toThrow(message);
    expect(out.lines).toEqual([]);
    expect(await count('tenants')).toBe(0);
  });

  it('requires the owner connection URL', async () => {
    await expect(runTenantCreate(ARGS, {}, capture().write)).rejects.toThrow(/DATABASE_MIGRATION_URL/);
  });
});

describe('db:seed', () => {
  it('is idempotent and creates the demo tenant with 2 locations and 3 users', async () => {
    await runSeed(OWNER_URL(), capture().write);
    await runSeed(OWNER_URL(), capture().write);

    expect(await count('tenants')).toBe(1);
    expect(await count('locations')).toBe(2);
    expect(await count('users')).toBe(3);
    expect(await count('roles')).toBe(3);
    expect(await count('role_assignments')).toBe(3);
    expect(await count('role_assignment_locations')).toBe(2);

    const scoped = await admin.query(
      `select u.email, r.key, a.scope, l.code
         from role_assignments a join users u on u.id = a.user_id join roles r on r.id = a.role_id
         left join role_assignment_locations al on al.assignment_id = a.id left join locations l on l.id = al.location_id
        order by u.email`,
    );
    expect(scoped.rows).toEqual([
      { email: DEMO_USERS.cashier.email, key: 'cashier', scope: 'locations', code: 'P1' },
      { email: DEMO_USERS.manager.email, key: 'manager', scope: 'locations', code: 'P1' },
      { email: DEMO_USERS.owner.email, key: 'owner', scope: 'tenant', code: null },
    ]);
  });

  it('seeds the Cashier with the SP3 read permissions (what GET /me shows for them)', async () => {
    await runSeed(OWNER_URL(), capture().write);
    const { rows } = await admin.query<{ permission: string }>(
      `select rp.permission from role_assignments a join users u on u.id = a.user_id
         join role_permissions rp on rp.role_id = a.role_id where u.email = $1`,
      [DEMO_USERS.cashier.email],
    );
    expect(rows.map((r) => r.permission).sort()).toEqual(
      ['cash:close', 'catalog:view', 'inventory:view', 'reports:view', 'sales:create'],
    );
  });

  it('does not reset a password changed after the first seed', async () => {
    await runSeed(OWNER_URL(), capture().write);
    await admin.query(`update users set password_hash = 'changed' where email = $1`, [DEMO_USERS.owner.email]);
    await runSeed(OWNER_URL(), capture().write);
    expect((await admin.query(`select password_hash from users where email = $1`, [DEMO_USERS.owner.email])).rows[0].password_hash).toBe('changed');
  });

  it.each(['production', 'Production', 'staging', ''])('refuses to run with NODE_ENV=%j', async (nodeEnv) => {
    await expect(runSeed({ ...OWNER_URL(), NODE_ENV: nodeEnv }, capture().write)).rejects.toThrow(/NODE_ENV/);
    expect(await count('tenants')).toBe(0);
  });

  it.each([undefined, 'development', 'test'])('runs with NODE_ENV=%s', async (nodeEnv) => {
    await runSeed({ ...OWNER_URL(), NODE_ENV: nodeEnv }, capture().write);
    expect(await count('tenants')).toBe(1);
  });

  it('fails clearly when a demo email already belongs to another tenant', async () => {
    await runTenantCreate(['--name', 'Mine', '--slug', 'mine', '--owner-email', DEMO_USERS.manager.email], OWNER_URL(), capture().write);
    await expect(runSeed(OWNER_URL(), capture().write)).rejects.toThrow(new RegExp(`${DEMO_USERS.manager.email}.*another tenant`));
    expect(await count('tenants')).toBe(1);
  });

  it('fails clearly when the demo slug belongs to another tenant', async () => {
    await runTenantCreate(['--name', 'Mine', '--slug', 'demo', '--owner-email', 'x@y.example'], OWNER_URL(), capture().write);
    await expect(runSeed(OWNER_URL(), capture().write)).rejects.toThrow(/demo/);
    expect(await count('tenants')).toBe(1);
  });

  describe('demo logins', () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await createAuthApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(Object.keys(DEMO_USERS) as (keyof typeof DEMO_USERS)[])('%s can log in with the documented password', async (role) => {
      await runSeed(OWNER_URL(), capture().write);
      const ip = freshIp();
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', ip))
        .send({ email: DEMO_USERS[role].email, password: DEMO_USERS[role].password, device: { label: 'seed check', platform: 'web' } })
        .expect(200);
      expect(AuthTokens.parse(res.body).accessToken).toBeTruthy();
    });
  });
});
