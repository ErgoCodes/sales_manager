import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPool, urls } from './helpers';


// Tables that are deliberately not tenant-scoped. Add by name, with a reason.
const NON_TENANT_TABLES: string[] = [];

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

  it('every table in public has a tenant_id uuid not null column', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select c.relname from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> all($1::text[])
         and not exists (
           select 1 from information_schema.columns k
           where k.table_schema = 'public' and k.table_name = c.relname
             and k.column_name = 'tenant_id' and k.data_type = 'uuid' and k.is_nullable = 'NO')`,
      [NON_TENANT_TABLES],
    );
    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('the guard query does see the probe table (it is not vacuous)', async () => {
    const { rows } = await admin.query("select 1 from pg_class where relname = '_tenancy_probe' and relrowsecurity and relforcerowsecurity");
    expect(rows).toHaveLength(1);
  });

  it('monaco_app cannot truncate, create tables or read the migrations journal', async () => {
    await expect(app.query('truncate table _tenancy_probe')).rejects.toThrow(/permission denied/i);
    await expect(app.query('create table app_made (id int)')).rejects.toThrow(/permission denied/i);
    await expect(app.query('select * from drizzle.__drizzle_migrations')).rejects.toThrow(/permission denied/i);
  });

  it('monaco_app and monaco_owner are neither superuser nor BYPASSRLS', async () => {
    const { rows } = await admin.query(
      `select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('monaco_app','monaco_owner') order by rolname`,
    );
    expect(rows).toEqual([
      { rolname: 'monaco_app', rolsuper: false, rolbypassrls: false },
      { rolname: 'monaco_owner', rolsuper: false, rolbypassrls: false },
    ]);
  });

  it('the owner is also subject to RLS (FORCE): sees no rows without a tenant', async () => {
    const owner = new Pool({ connectionString: urls().owner, max: 1 });
    try {
      await admin.query("insert into _tenancy_probe (tenant_id, label) values ('11111111-1111-4111-8111-111111111111', 'x')");
      expect((await owner.query('select 1 from _tenancy_probe')).rowCount).toBe(0);
    } finally {
      await owner.end();
      await admin.query('truncate table _tenancy_probe');
    }
  });
});
