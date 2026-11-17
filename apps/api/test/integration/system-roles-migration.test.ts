import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PERMISSIONS } from '@monaco/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SYSTEM_ROLES } from '../../src/modules/iam/domain/system-roles';
import { adminPool, urls } from './helpers';

// SP3·T2, D11: the data migration that backfills catalog:view / inventory:view into the
// system roles of tenants that existed before it.
const apiRoot = resolve(__dirname, '../..');
const migrationsFolder = resolve(apiRoot, 'drizzle');
const initSql = readFileSync(resolve(apiRoot, '../../infra/postgres/init.sql'), 'utf8');
const dataMigration = readFileSync(resolve(migrationsFolder, '0009_sp3_system_roles_read_permissions.sql'), 'utf8');
const statements = dataMigration.split('--> statement-breakpoint');
const DATABASE = 'monaco_sp3_roles';
/** Migrations applied by SP2: everything before the SP3 CHECK change (0008) and the data migration (0009). */
const PRE_SP3_MIGRATIONS = 8;
const OLD_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'catalog:view' && p !== 'inventory:view');
const OLD_SYSTEM: Record<string, readonly string[]> = {
  owner: OLD_PERMISSIONS,
  manager: SYSTEM_ROLES.manager.permissions.filter((p) => p !== 'catalog:view' && p !== 'inventory:view'),
  cashier: SYSTEM_ROLES.cashier.permissions.filter((p) => p !== 'catalog:view' && p !== 'inventory:view'),
};

const TENANT_OLD = '33333333-3333-4333-8333-333333333333';
const TENANT_LATE = '44444444-4444-4444-8444-444444444444';

const urlFor = (base: string) => {
  const url = new URL(base);
  url.pathname = `/${DATABASE}`;
  return url.toString();
};

function partialFolder(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'monaco-sp3-migrations-'));
  cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function migrateAsOwner(folder: string) {
  const pool = new Pool({ connectionString: urlFor(urls().owner), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

/** Runs the data migration statements as monaco_owner in one transaction, like the migrator does. */
async function runDataMigration(extra?: string) {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    for (const sql of statements) await client.query(sql);
    if (extra) await client.query(extra);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedSystemRoles(tenantId: string, slug: string) {
  await target.query(`insert into tenants (id, name, slug) values ($1, $2, $2)`, [tenantId, slug]);
  for (const [key, permissions] of Object.entries(OLD_SYSTEM)) {
    const { rows } = await target.query<{ id: string }>(
      `insert into roles (id, tenant_id, key, name, is_system) values (gen_random_uuid(), $1, $2, $3, true) returning id`,
      [tenantId, key, key],
    );
    for (const permission of permissions) {
      await target.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, $2, $3)`, [rows[0]!.id, permission, tenantId]);
    }
  }
}

async function rolePermissionsByKey(tenantId: string): Promise<Record<string, string[]>> {
  const { rows } = await target.query<{ key: string; permissions: string[] }>(
    `select r.key, array_agg(rp.permission order by rp.permission) as permissions
       from roles r join role_permissions rp on rp.role_id = r.id and rp.tenant_id = r.tenant_id
      where r.tenant_id = $1 and r.is_system group by r.key`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.permissions]));
}

const forceState = async () =>
  (
    await target.query(
      `select relname, relrowsecurity as rls, relforcerowsecurity as forced from pg_class
        where relname in ('roles', 'role_permissions') and relnamespace = 'public'::regnamespace order by relname`,
    )
  ).rows;
const FORCED = [
  { relname: 'role_permissions', rls: true, forced: true },
  { relname: 'roles', rls: true, forced: true },
];
const policies = async () =>
  (await target.query(`select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('roles','role_permissions') order by 1, 2`)).rows;

let admin: Pool;
let target: Pool;
let owner: Pool;
let preFolder: string;
let policiesBefore: unknown[];

beforeAll(async () => {
  admin = adminPool();
  await admin.query(`drop database if exists ${DATABASE}`);
  await admin.query(`create database ${DATABASE}`);
  target = new Pool({ connectionString: urlFor(urls().admin), max: 1 });
  await target.query(initSql);
  preFolder = partialFolder(PRE_SP3_MIGRATIONS);
  await migrateAsOwner(preFolder);
  // A tenant created before SP3: old system roles, plus a custom role that must stay untouched.
  await seedSystemRoles(TENANT_OLD, 'old-tenant');
  const custom = await target.query<{ id: string }>(
    `insert into roles (id, tenant_id, name, is_system) values (gen_random_uuid(), $1, 'Custom', false) returning id`,
    [TENANT_OLD],
  );
  await target.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, 'catalog:write', $2)`, [custom.rows[0]!.id, TENANT_OLD]);
  policiesBefore = await policies();
  owner = new Pool({ connectionString: urlFor(urls().owner), max: 1 });
});
afterAll(async () => {
  await owner.end();
  await target.end();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.end();
  rmSync(preFolder, { recursive: true, force: true });
});

describe('SP3 data migration of the system roles (D11)', () => {
  it('before it, the pre-SP3 tenant has the old permissions and the table is FORCEd', async () => {
    expect(await rolePermissionsByKey(TENANT_OLD)).toEqual(
      Object.fromEntries(Object.entries(OLD_SYSTEM).map(([k, v]) => [k, [...v].sort()])),
    );
    expect(await forceState()).toEqual(FORCED);
  });

  it('gives a tenant created before the migration the new permissions: system roles equal SYSTEM_ROLES', async () => {
    await migrateAsOwner(migrationsFolder);
    const actual = await rolePermissionsByKey(TENANT_OLD);
    for (const spec of Object.values(SYSTEM_ROLES)) expect(actual[spec.key]).toEqual([...spec.permissions].sort());
  });

  it('never grants anything to a custom role', async () => {
    const { rows } = await target.query(
      `select r.name, array_agg(rp.permission order by rp.permission) as permissions
         from roles r join role_permissions rp on rp.role_id = r.id where not r.is_system group by r.name`,
    );
    expect(rows).toEqual([{ name: 'Custom', permissions: ['catalog:write'] }]);
  });

  it('keeps FORCE ROW LEVEL SECURITY on roles and role_permissions, and every policy intact', async () => {
    expect(await forceState()).toEqual(FORCED);
    expect(await policies()).toEqual(policiesBefore);
  });

  it('a second run is a no-op (idempotent) and FORCE is still on', async () => {
    const count = async () => (await target.query('select count(*)::int as n from role_permissions')).rows[0].n;
    const before = await count();
    await runDataMigration();
    await runDataMigration();
    expect(await count()).toBe(before);
    expect(await forceState()).toEqual(FORCED);
  });

  it('is re-runnable: a tenant created later by the old code (missing the new permissions) is fixed by running it again', async () => {
    await seedSystemRoles(TENANT_LATE, 'late-tenant');
    expect((await rolePermissionsByKey(TENANT_LATE)).cashier).not.toContain('catalog:view');
    await runDataMigration();
    const actual = await rolePermissionsByKey(TENANT_LATE);
    for (const spec of Object.values(SYSTEM_ROLES)) expect(actual[spec.key]).toEqual([...spec.permissions].sort());
    expect(await forceState()).toEqual(FORCED);
  });

  it('a failure inside the transaction rolls back the NO FORCE too: FORCE is still on', async () => {
    await expect(runDataMigration(`select 1/0`)).rejects.toThrow(/division by zero/);
    expect(await forceState()).toEqual(FORCED);
  });

  it('runs as monaco_owner, which stays without BYPASSRLS, and monaco_app still cannot see tenants without a context', async () => {
    const { rows } = await admin.query(`select rolbypassrls from pg_roles where rolname = 'monaco_owner'`);
    expect(rows).toEqual([{ rolbypassrls: false }]);
    const app = new Pool({ connectionString: urlFor(urls().app), max: 1 });
    try {
      expect((await app.query('select count(*)::int as n from role_permissions')).rows).toEqual([{ n: 0 }]);
    } finally {
      await app.end();
    }
  });
});
