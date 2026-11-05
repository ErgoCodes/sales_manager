import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPool, resetTenants, seedTenants, urls } from './helpers';

// Tables that are deliberately not tenant-scoped. Add by name, with a reason.
const NON_TENANT_TABLES: string[] = [];
// RLS + FORCE like every other table, but the row *is* the tenant: no
// tenant_id column, its policy compares id (ADR 0003).
const ROW_IS_TENANT = ['tenants'];

const policyOn = (column: string) => `(${column} = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`;

let admin: Pool;
let app: Pool;
beforeAll(() => {
  admin = adminPool();
  app = new Pool({ connectionString: urls().app, max: 1 });
});
afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('real schema guards (ADR 0003)', () => {
  it('every table in public has RLS enabled and forced', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'
         and (not relrowsecurity or not relforcerowsecurity)
         and relname <> all($1::text[])`,
      [NON_TENANT_TABLES],
    );
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('every table in public but tenants has a tenant_id uuid not null column', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select c.relname from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> all($1::text[])
         and not exists (
           select 1 from information_schema.columns k
           where k.table_schema = 'public' and k.table_name = c.relname
             and k.column_name = 'tenant_id' and k.data_type = 'uuid' and k.is_nullable = 'NO')`,
      [[...NON_TENANT_TABLES, ...ROW_IS_TENANT]],
    );
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('every table has exactly the isolation policy: on tenant_id, or on id for tenants', async () => {
    const { rows } = await admin.query<{ relname: string; policies: { cmd: string; roles: string[]; permissive: string; qual: string; with_check: string }[] }>(
      `select c.relname,
              coalesce(json_agg(json_build_object('cmd', p.cmd, 'roles', p.roles, 'permissive', p.permissive,
                                                  'qual', p.qual, 'with_check', p.with_check))
                       filter (where p.policyname is not null), '[]') as policies
       from pg_class c
       left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> all($1::text[])
       group by c.relname order by c.relname`,
      [NON_TENANT_TABLES],
    );
    for (const { relname, policies } of rows) {
      const expected = policyOn(ROW_IS_TENANT.includes(relname) ? 'id' : 'tenant_id');
      expect(policies, relname).toEqual([{ cmd: 'ALL', roles: ['public'], permissive: 'PERMISSIVE', qual: expected, with_check: expected }]);
    }
  });

  it('the guard queries do see the real tables (they are not vacuous)', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity and relforcerowsecurity
       order by relname`,
    );
    expect(rows.map((row) => row.relname)).toEqual([
      'audit_events',
      'devices',
      'locations',
      'refresh_tokens',
      'role_assignment_locations',
      'role_assignments',
      'role_permissions',
      'roles',
      'tenants',
      'users',
    ]);
    expect((await admin.query("select 1 from pg_class where relname = '_tenancy_probe'")).rowCount).toBe(0);
  });

  it('monaco_app cannot truncate, create tables or read the migrations journal', async () => {
    await expect(app.query('truncate table locations')).rejects.toThrow(/permission denied/i);
    await expect(app.query('create table app_made (id int)')).rejects.toThrow(/permission denied/i);
    await expect(app.query('select * from drizzle.__drizzle_migrations')).rejects.toThrow(/permission denied/i);
  });

  it('monaco_app has exactly the DML each table needs', async () => {
    const { rows } = await admin.query<{ relname: string; privileges: string[] }>(
      `select c.relname, array_agg(a.privilege_type order by a.privilege_type) as privileges
       from pg_class c, aclexplode(c.relacl) a
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.grantee = 'monaco_app'::regrole
       group by c.relname order by c.relname`,
    );
    const crud = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
    const noDelete = ['INSERT', 'SELECT', 'UPDATE'];
    expect(Object.fromEntries(rows.map((row) => [row.relname, row.privileges]))).toEqual({
      audit_events: ['INSERT', 'SELECT'],
      devices: noDelete,
      locations: noDelete,
      refresh_tokens: noDelete,
      role_assignment_locations: crud,
      role_assignments: crud,
      role_permissions: crud,
      roles: crud,
      tenants: ['SELECT', 'UPDATE'],
      users: noDelete,
    });
  });

  it('no login role but the bootstrap superuser has BYPASSRLS; monaco_app and monaco_owner are not superusers', async () => {
    const { rows: bypass } = await admin.query('select rolname from pg_roles where rolcanlogin and rolbypassrls and not rolsuper');
    expect(bypass).toEqual([]);
    const { rows } = await admin.query(
      `select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
       where rolname in ('monaco_app', 'monaco_auth', 'monaco_owner') order by rolname`,
    );
    expect(rows).toEqual([
      { rolname: 'monaco_app', rolsuper: false, rolbypassrls: false, rolcanlogin: true },
      // The SECURITY DEFINER owner: BYPASSRLS, but nobody can log in as it.
      { rolname: 'monaco_auth', rolsuper: false, rolbypassrls: true, rolcanlogin: false },
      { rolname: 'monaco_owner', rolsuper: false, rolbypassrls: false, rolcanlogin: true },
    ]);
  });

  it('only monaco_owner can become monaco_auth, and only by an explicit SET ROLE', async () => {
    const { rows } = await admin.query(
      `select m.member::regrole::text as member, m.inherit_option, m.set_option, m.admin_option
       from pg_auth_members m where m.roleid = 'monaco_auth'::regrole`,
    );
    expect(rows).toEqual([{ member: 'monaco_owner', inherit_option: false, set_option: true, admin_option: false }]);
    await expect(app.query('set role monaco_auth')).rejects.toThrow(/permission denied/i);
  });

  it('the owner is also subject to RLS (FORCE): sees no rows without a tenant', async () => {
    const owner = new Pool({ connectionString: urls().owner, max: 1 });
    try {
      await resetTenants(admin);
      await seedTenants(admin);
      expect((await owner.query('select 1 from roles')).rowCount).toBe(0);
      expect((await owner.query('select 1 from tenants')).rowCount).toBe(0);
    } finally {
      await owner.end();
      await resetTenants(admin);
    }
  });
});
