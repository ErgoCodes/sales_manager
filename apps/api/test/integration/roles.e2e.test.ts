import { PaginatedRoles, Role } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditRows, loginAs, resetAll, type SeededTenant, Seeder } from './admin-fixtures';
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

const permissionsOf = async (roleId: string) =>
  (await admin.query<{ permission: string }>('select permission from role_permissions where role_id = $1 order by permission', [roleId])).rows.map((r) => r.permission);
const roleExists = async (roleId: string) => (await admin.query('select 1 from roles where id = $1', [roleId])).rowCount === 1;

describe('roles', () => {
  it('an Owner creates, edits and deletes a custom role; each step is audited', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const created = Role.parse((await owner.post('/roles', { name: 'Caja+', permissions: ['sales:void', 'sales:create'] }).expect(201)).body);
    expect(created).toMatchObject({ name: 'Caja+', key: null, isSystem: false, permissions: ['sales:create', 'sales:void'] });

    const edited = Role.parse((await owner.patch(`/roles/${created.id}`, { name: 'Caja++', permissions: ['reports:view'] }).expect(200)).body);
    expect(edited).toMatchObject({ id: created.id, name: 'Caja++', permissions: ['reports:view'] });
    expect(await permissionsOf(created.id)).toEqual(['reports:view']);

    await owner.delete(`/roles/${created.id}`).expect(204);
    expect(await roleExists(created.id)).toBe(false);

    const audit = (await auditRows(admin, a.id)).filter((row) => row.type.startsWith('role_'));
    expect(audit.map((row) => [row.type, row.actor_user_id, row.target_id])).toEqual([
      ['role_created', a.owner, created.id],
      ['role_updated', a.owner, created.id],
      ['role_deleted', a.owner, created.id],
    ]);
  });

  it('lists the roles, paginated', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const page = PaginatedRoles.parse((await owner.get('/roles?limit=2').expect(200)).body);
    expect(page.items.map((r) => r.key)).toEqual(['owner', 'manager']);
    const rest = PaginatedRoles.parse((await owner.get(`/roles?cursor=${page.nextCursor}`).expect(200)).body);
    expect(rest).toMatchObject({ items: [{ key: 'cashier' }], nextCursor: null });
  });

  it('a duplicate name is a generic 409', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    expect((await owner.post('/roles', { name: 'Manager', permissions: ['sales:create'] }).expect(409)).body).toEqual({
      error: { code: 'CONFLICT', message: 'Conflict' },
    });
  });

  it('system roles: the Owner role is not edited, no system role is deleted, a role in use is not deleted (409)', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    expect((await owner.patch(`/roles/${a.roles.owner}`, { name: 'Boss' }).expect(409)).body.error.code).toBe('SYSTEM_ROLE_IMMUTABLE');
    expect((await owner.delete(`/roles/${a.roles.owner}`).expect(409)).body.error.code).toBe('SYSTEM_ROLE_IMMUTABLE');
    expect((await owner.delete(`/roles/${a.roles.cashier}`).expect(409)).body.error.code).toBe('SYSTEM_ROLE_IMMUTABLE');
    // The Manager system role can be edited.
    await owner.patch(`/roles/${a.roles.manager}`, { name: 'Encargado' }).expect(200);

    const used = await seeder.role(a.id, 'Usado', ['sales:create']);
    await seeder.user(a.id, 'u@a.example', [[used, [a.locations[0]]]]);
    expect((await owner.delete(`/roles/${used}`).expect(409)).body.error.code).toBe('ROLE_IN_USE');
    expect(await roleExists(used)).toBe(true);
  });

  it('adding an administrative permission to a role held with a locations scope is 422', async () => {
    const owner = await loginAs(app, 'owner@a.example');
    const role = await seeder.role(a.id, 'Local', ['sales:create']);
    await seeder.user(a.id, 'u@a.example', [[role, [a.locations[0]]]]);
    expect((await owner.patch(`/roles/${role}`, { permissions: ['sales:create', 'locations:manage'] }).expect(422)).body.error.code).toBe('INVALID_SCOPE');
    expect(await permissionsOf(role)).toEqual(['sales:create']);
  });

  describe('no escalation', () => {
    let custom: string;
    beforeEach(async () => {
      // A non-Owner administrator: roles:manage plus sales:create, tenant-wide.
      const adminRole = await seeder.role(a.id, 'RoleAdmin', ['roles:manage', 'sales:create']);
      await seeder.user(a.id, 'roles@a.example', [[adminRole, 'tenant']]);
      custom = await seeder.role(a.id, 'Custom', ['sales:create']);
    });

    it('may hand out what it holds tenant-wide, nothing else; the reason is audited, never returned', async () => {
      const roleAdmin = await loginAs(app, 'roles@a.example');
      await roleAdmin.post('/roles', { name: 'Ok', permissions: ['sales:create'] }).expect(201);
      expect((await roleAdmin.post('/roles', { name: 'Void', permissions: ['sales:void'] }).expect(403)).body).toEqual({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
      await roleAdmin.post('/roles', { name: 'Users', permissions: ['users:manage'] }).expect(403);
      await roleAdmin.patch(`/roles/${custom}`, { permissions: ['sales:create', 'sales:void'] }).expect(403);
      await roleAdmin.patch(`/roles/${custom}`, { permissions: ['sales:create', 'roles:manage'] }).expect(403);
      await roleAdmin.patch(`/roles/${a.roles.manager}`, { permissions: ['sales:create'] }).expect(403);
      expect(await permissionsOf(custom)).toEqual(['sales:create']);

      const denied = (await auditRows(admin, a.id)).filter((row) => row.type === 'escalation_denied');
      expect(denied.map((row) => row.metadata)).toEqual([
        { operation: 'create_role', reason: 'permission_not_held' },
        { operation: 'create_role', reason: 'owner_only' },
        { operation: 'update_role', reason: 'permission_not_held' },
        { operation: 'update_role', reason: 'owner_only' },
        { operation: 'update_role', reason: 'permission_not_held' },
      ]);
    });

    it('cannot delete a role with permissions it does not hold', async () => {
      const roleAdmin = await loginAs(app, 'roles@a.example');
      const strong = await seeder.role(a.id, 'Strong', ['sales:void']);
      await roleAdmin.delete(`/roles/${strong}`).expect(403);
      await roleAdmin.delete(`/roles/${custom}`).expect(204);
      expect(await roleExists(strong)).toBe(true);
    });
  });

  it('a cashier gets 403 everywhere and changes nothing', async () => {
    await seeder.user(a.id, 'cashier@a.example', [[a.roles.cashier, [a.locations[0]]]]);
    const cashier = await loginAs(app, 'cashier@a.example');
    await cashier.get('/roles').expect(403);
    await cashier.post('/roles', { name: 'X', permissions: ['sales:create'] }).expect(403);
    await cashier.patch(`/roles/${a.roles.cashier}`, { name: 'X' }).expect(403);
    await cashier.delete(`/roles/${a.roles.cashier}`).expect(403);
    expect(await roleExists(a.roles.cashier)).toBe(true);
  });
});
