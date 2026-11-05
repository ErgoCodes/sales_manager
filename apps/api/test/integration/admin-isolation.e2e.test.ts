import { PaginatedAuditEvents, PaginatedDevices, PaginatedLocations, PaginatedRoles, PaginatedUsers } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loginAs, raceOnTenantMutex, resetAll, type SeededTenant, Seeder, type Session } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';

/*
 * The SP2 exit gate for the administration API (plan T4): tenant A against
 * every endpoint with tenant B's ids gets 404 and B stays byte-for-byte the
 * same; the location scope holds; and the last Owner survives two concurrent
 * requests on every route that can touch an Owner.
 */

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

/** Every row of tenant B in every IAM table, as JSON (superuser, no RLS). */
async function snapshot(tenantId: string): Promise<string> {
  const tables = ['tenants', 'locations', 'users', 'roles', 'role_permissions', 'role_assignments', 'role_assignment_locations', 'devices', 'refresh_tokens', 'audit_events'];
  const out: Record<string, unknown> = {};
  for (const table of tables) {
    const column = table === 'tenants' ? 'id' : 'tenant_id';
    out[table] = (await admin.query(`select to_jsonb(t) as row from ${table} t where ${column} = $1 order by 1`, [tenantId])).rows.map((r) => JSON.stringify(r.row)).sort();
  }
  return JSON.stringify(out);
}

describe('cross-tenant matrix', () => {
  it("tenant A gets 404 on every endpoint with tenant B's ids, and B is untouched", async () => {
    const bUser = await seeder.user(b.id, 'cashier@b.example', [[b.roles.cashier, [b.locations[0]]]]);
    const bCustom = await seeder.role(b.id, 'Custom B', ['sales:create']);
    const bSession = await loginAs(app, 'cashier@b.example');
    const aUser = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const owner = await loginAs(app, 'owner@a.example');
    const before = await snapshot(b.id);

    const cases: [string, () => ReturnType<Session['get']>][] = [
      ['PATCH /locations/:id', () => owner.patch(`/locations/${b.locations[0]}`, { name: 'X' })],
      ['POST /locations/:id/archive', () => owner.post(`/locations/${b.locations[0]}/archive`)],
      ['GET /users/:id', () => owner.get(`/users/${bUser}`)],
      ['PATCH /users/:id', () => owner.patch(`/users/${bUser}`, { displayName: 'X' })],
      ['POST /users/:id/disable', () => owner.post(`/users/${bUser}/disable`)],
      ['POST /users/:id/reset-password', () => owner.post(`/users/${bUser}/reset-password`)],
      ['PUT /users/:id/assignments (B user)', () => owner.put(`/users/${bUser}/assignments`, { assignments: [] })],
      ['PUT /users/:id/assignments (B owner)', () => owner.put(`/users/${b.owner}/assignments`, { assignments: [] })],
      ['PUT /users/:id/assignments (B role)', () => owner.put(`/users/${aUser}/assignments`, { assignments: [{ roleId: bCustom, scope: { type: 'tenant' } }] })],
      [
        'PUT /users/:id/assignments (B location)',
        () => owner.put(`/users/${aUser}/assignments`, { assignments: [{ roleId: a.roles.cashier, scope: { type: 'locations', locationIds: [b.locations[0]] } }] }),
      ],
      ['PATCH /roles/:id', () => owner.patch(`/roles/${bCustom}`, { name: 'X' })],
      ['PATCH /roles/:id (B system role)', () => owner.patch(`/roles/${b.roles.manager}`, { permissions: ['sales:create'] })],
      ['DELETE /roles/:id', () => owner.delete(`/roles/${bCustom}`)],
      ['GET /devices?userId', () => owner.get(`/devices?userId=${bUser}`)],
      ['POST /devices/:id/revoke', () => owner.post(`/devices/${bSession.deviceId}/revoke`)],
    ];
    for (const [label, call] of cases) {
      const res = await call();
      expect([label, res.status, res.body]).toEqual([label, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } }]);
    }

    // Listings never show B's rows.
    const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);
    const bIds = new Set([b.id, bUser, b.owner, bCustom, bSession.deviceId, ...b.locations, ...Object.values(b.roles)]);
    for (const [path, schema] of [
      ['/locations?limit=100', PaginatedLocations],
      ['/users?limit=100', PaginatedUsers],
      ['/roles?limit=100', PaginatedRoles],
      ['/devices?limit=100', PaginatedDevices],
      ['/audit-events?limit=100', PaginatedAuditEvents],
    ] as const) {
      const page = schema.parse((await owner.get(path).expect(200)).body);
      expect(ids(page).filter((id) => bIds.has(id)), path).toEqual([]);
    }

    // A's own user gained nothing from the failed attempts either.
    expect((await admin.query('select count(*)::int as n from role_assignments where user_id = $1', [aUser])).rows[0].n).toBe(1);
    expect(await snapshot(b.id)).toBe(before);
    await bSession.get('/me').expect(200);
  });
});

describe('location scope', () => {
  it('a cashier of location 1 who may manage devices there gets 403 at location 2', async () => {
    const [l1, l2] = a.locations;
    const cashierPlus = await seeder.role(a.id, 'Cashier+devices', ['sales:create', 'devices:manage']);
    await seeder.user(a.id, 'lead@a.example', [[cashierPlus, [l1]]]);
    const atL1 = await seeder.user(a.id, 'one@a.example', [[a.roles.cashier, [l1]]]);
    const atL2 = await seeder.user(a.id, 'two@a.example', [[a.roles.cashier, [l2]]]);
    const deviceL1 = (await loginAs(app, 'one@a.example')).deviceId;
    const deviceL2 = (await loginAs(app, 'two@a.example')).deviceId;
    const lead = await loginAs(app, 'lead@a.example');

    expect(PaginatedLocations.parse((await lead.get('/locations').expect(200)).body).items.map((l) => l.id)).toEqual([l1]);
    await lead.get(`/devices?userId=${atL1}`).expect(200);
    await lead.get(`/devices?userId=${atL2}`).expect(403);
    await lead.post(`/devices/${deviceL2}/revoke`).expect(403);
    await lead.post(`/devices/${deviceL1}/revoke`).expect(200);
    expect((await admin.query('select revoked_at is null as live from devices where id = $1', [deviceL2])).rows[0].live).toBe(true);
  });
});

describe('last Owner, two concurrent requests per route', () => {
  let second: string;
  let one: Session;
  let two: Session;
  beforeEach(async () => {
    second = await seeder.user(a.id, 'owner2@a.example', [[a.roles.owner, 'tenant']]);
    one = await loginAs(app, 'owner@a.example');
    two = await loginAs(app, 'owner2@a.example');
  });
  const activeOwners = async () =>
    (
      await admin.query(
        `select count(*)::int as n from role_assignments ra join users u on u.id = ra.user_id
         where ra.tenant_id = $1 and ra.role_id = $2 and ra.scope = 'tenant' and u.status = 'active'`,
        [a.id, a.roles.owner],
      )
    ).rows[0].n as number;

  it('assignments: one demotion wins, the other is 409', async () => {
    const results = await raceOnTenantMutex(admin, a.id, 2, () =>
      Promise.all([one.put(`/users/${second}/assignments`, { assignments: [] }), two.put(`/users/${a.owner}/assignments`, { assignments: [] })]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await activeOwners()).toBe(1);
  });

  it('disable: one wins, the other is 409', async () => {
    const results = await raceOnTenantMutex(admin, a.id, 2, () => Promise.all([one.post(`/users/${second}/disable`), two.post(`/users/${a.owner}/disable`)]));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await activeOwners()).toBe(1);
  });

  it('disable + demotion mixed: still one Owner left', async () => {
    const results = await raceOnTenantMutex(admin, a.id, 2, () =>
      Promise.all([one.post(`/users/${second}/disable`), two.put(`/users/${a.owner}/assignments`, { assignments: [] })]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await activeOwners()).toBe(1);
  });

  it('reset: both resets serialize and both Owners stay active (a reset cannot remove an Owner)', async () => {
    const results = await raceOnTenantMutex(admin, a.id, 2, () =>
      Promise.all([one.post(`/users/${second}/reset-password`), two.post(`/users/${a.owner}/reset-password`)]),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await activeOwners()).toBe(2);
  });

  it('roles: the Owner role can be neither edited nor deleted, also concurrently (409)', async () => {
    const results = await raceOnTenantMutex(admin, a.id, 2, () =>
      Promise.all([one.patch(`/roles/${a.roles.owner}`, { permissions: ['sales:create'] }), two.delete(`/roles/${a.roles.owner}`)]),
    );
    expect(results.map((r) => [r.status, r.body.error.code])).toEqual([
      [409, 'SYSTEM_ROLE_IMMUTABLE'],
      [409, 'SYSTEM_ROLE_IMMUTABLE'],
    ]);
    expect(await activeOwners()).toBe(2);
  });
});
