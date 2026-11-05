import { MeResponse, ReplaceAssignmentsResponse } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditRows, loginAs, raceOnTenantMutex, resetAll, type SeededTenant, Seeder } from './admin-fixtures';
import { createAuthApp } from './auth-fixtures';
import { adminPool } from './helpers';

let app: NestExpressApplication;
let admin: Pool;
let seeder: Seeder;
let a: SeededTenant;

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
});

const assignmentsOf = async (userId: string) =>
  (
    await admin.query<{ role_id: string; scope: string; locations: string[] }>(
      `select a.role_id, a.scope, coalesce(array_agg(l.location_id order by l.location_id) filter (where l.location_id is not null), '{}') as locations
       from role_assignments a left join role_assignment_locations l on l.assignment_id = a.id
       where a.user_id = $1 group by a.id order by a.role_id`,
      [userId],
    )
  ).rows;

describe('PUT /users/:id/assignments', () => {
  it('replaces the whole set atomically; the new permissions apply on the next request', async () => {
    const user = await seeder.user(a.id, 'u@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const session = await loginAs(app, 'u@a.example');
    const owner = await loginAs(app, 'owner@a.example');

    const body = { assignments: [{ roleId: a.roles.manager, scope: { type: 'locations', locationIds: [a.locations[1]] } }] };
    const res = ReplaceAssignmentsResponse.parse((await owner.put(`/users/${user}/assignments`, body).expect(200)).body);
    expect(res.assignments).toEqual([{ id: expect.any(String), ...body.assignments[0] }]);
    expect(await assignmentsOf(user)).toEqual([{ role_id: a.roles.manager, scope: 'locations', locations: [a.locations[1]] }]);

    const me = MeResponse.parse((await session.get('/me').expect(200)).body);
    expect(me.permissions.map((p) => p.scope)).toEqual(me.permissions.map(() => ({ type: 'locations', locationIds: [a.locations[1]] })));
    expect(me.permissions.map((p) => p.permission)).toContain('devices:manage');
    expect((await auditRows(admin, a.id)).filter((r) => r.type === 'assignments_replaced')).toEqual([
      expect.objectContaining({ actor_user_id: a.owner, target_id: user }),
    ]);

    await owner.put(`/users/${user}/assignments`, { assignments: [] }).expect(200);
    expect(await assignmentsOf(user)).toEqual([]);
  });

  it('an administrative permission with a locations scope is 422; unknown roles or locations are 404', async () => {
    const user = await seeder.user(a.id, 'u@a.example');
    const adminRole = await seeder.role(a.id, 'LocAdmin', ['locations:manage']);
    const owner = await loginAs(app, 'owner@a.example');
    const put = (assignments: object[]) => owner.put(`/users/${user}/assignments`, { assignments });
    expect((await put([{ roleId: adminRole, scope: { type: 'locations', locationIds: [a.locations[0]] } }]).expect(422)).body.error.code).toBe('INVALID_SCOPE');
    await put([{ roleId: '0190a000-0000-7000-8000-000000000999', scope: { type: 'tenant' } }]).expect(404);
    await put([{ roleId: a.roles.cashier, scope: { type: 'locations', locationIds: ['0190a000-0000-7000-8000-000000000999'] } }]).expect(404);
    await owner.put('/users/0190a000-0000-7000-8000-000000000999/assignments', { assignments: [] }).expect(404);
    expect(await assignmentsOf(user)).toEqual([]);
  });

  it('an archived location cannot be assigned (404)', async () => {
    const user = await seeder.user(a.id, 'u@a.example');
    await admin.query('update locations set archived_at = now() where id = $1', [a.locations[1]]);
    const owner = await loginAs(app, 'owner@a.example');
    await owner.put(`/users/${user}/assignments`, { assignments: [{ roleId: a.roles.cashier, scope: { type: 'locations', locationIds: [a.locations[1]] } }] }).expect(404);
  });

  it('removing the last Owner is 409, and two Owners demoting each other at once leave one (409 for the loser)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    // Not on oneself (403): the last Owner is protected even from a second Owner's request.
    await owner.put(`/users/${a.owner}/assignments`, { assignments: [] }).expect(403);

    const second = await seeder.user(a.id, 'owner2@a.example', [[a.roles.owner, 'tenant']]);
    const two = await loginAs(app, 'owner2@a.example');
    const results = await raceOnTenantMutex(admin, a.id, 2, () =>
      Promise.all([owner.put(`/users/${second}/assignments`, { assignments: [] }), two.put(`/users/${a.owner}/assignments`, { assignments: [] })]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await admin.query(
      `select count(*)::int as n from role_assignments where tenant_id = $1 and role_id = $2 and scope = 'tenant'`,
      [a.id, a.roles.owner],
    );
    expect(rows[0].n).toBe(1);
  });

  describe('no escalation', () => {
    let manager: string;
    let cashier: string;
    beforeEach(async () => {
      // A Manager who was also given users:manage + roles:manage through a custom tenant-wide role.
      const custom = await seeder.role(a.id, 'Admin', ['users:manage', 'roles:manage']);
      manager = await seeder.user(a.id, 'manager@a.example', [
        [a.roles.manager, [a.locations[0]]],
        [custom, 'tenant'],
      ]);
      cashier = await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    });

    it('cannot give itself or anyone Owner, cannot touch its own assignments, cannot exceed its scope', async () => {
      const m = await loginAs(app, 'manager@a.example');
      const put = (userId: string, assignments: object[]) => m.put(`/users/${userId}/assignments`, { assignments });
      await put(manager, [{ roleId: a.roles.owner, scope: { type: 'tenant' } }]).expect(403);
      await put(manager, []).expect(403);
      await put(cashier, [{ roleId: a.roles.owner, scope: { type: 'tenant' } }]).expect(403);
      await put(cashier, [{ roleId: a.roles.manager, scope: { type: 'tenant' } }]).expect(403);
      await put(cashier, [{ roleId: a.roles.cashier, scope: { type: 'locations', locationIds: [a.locations[1]] } }]).expect(403);
      // Within its own locations it can.
      await put(cashier, [{ roleId: a.roles.manager, scope: { type: 'locations', locationIds: [a.locations[0]] } }]).expect(200);

      expect(await assignmentsOf(cashier)).toEqual([{ role_id: a.roles.manager, scope: 'locations', locations: [a.locations[0]] }]);
      const reasons = (await auditRows(admin, a.id)).filter((r) => r.type === 'escalation_denied').map((r) => r.metadata.reason);
      expect(reasons).toEqual(['self_modification', 'self_modification', 'owner_only', 'scope_exceeds', 'scope_exceeds']);
    });

    it('needs both users:manage and roles:manage', async () => {
      const onlyUsers = await seeder.role(a.id, 'OnlyUsers', ['users:manage']);
      await seeder.user(a.id, 'half@a.example', [[onlyUsers, 'tenant']]);
      const half = await loginAs(app, 'half@a.example');
      await half.put(`/users/${cashier}/assignments`, { assignments: [] }).expect(403);
      expect(await assignmentsOf(cashier)).toHaveLength(1);
    });
  });
});
