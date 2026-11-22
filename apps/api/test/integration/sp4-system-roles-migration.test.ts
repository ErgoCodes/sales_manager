import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SYSTEM_ROLES } from '../../src/modules/iam/domain/system-roles';
import { adminPool, urls } from './helpers';
import { SP3_SYSTEM_ROLES } from './system-roles-history';

// SP4·T3, D4: the data migration that grants reports:view_own to the system Owner and Cashier
// and removes reports:view from the system Cashier, following the SP3·D11 procedure.
const apiRoot = resolve(__dirname, '../..');
const migrationsFolder = resolve(apiRoot, 'drizzle');
const initSql = readFileSync(resolve(apiRoot, '../../infra/postgres/init.sql'), 'utf8');
const MIGRATION_FILE = '0013_sp4_system_roles_reports_view_own.sql';
const statements = readFileSync(resolve(migrationsFolder, MIGRATION_FILE), 'utf8').split('--> statement-breakpoint');
const DATABASE = 'monaco_sp4_roles';
/** Migrations applied by SP3: everything before the SP4 CHECK change (0012) and the data migration (0013). */
const PRE_SP4_MIGRATIONS = 12;

const TENANT_OLD = '55555555-5555-4555-8555-555555555555';
const TENANT_LATE = '66666666-6666-4666-8666-666666666666';
/** Custom roles must come out unchanged, including one with reports:view. */
const CUSTOM_ROLES = {
  Reportes: ['reports:view'],
  'Caja y reportes': ['cash:close', 'reports:view', 'sales:create'],
};

const urlFor = (base: string) => {
  const url = new URL(base);
  url.pathname = `/${DATABASE}`;
  return url.toString();
};

function partialFolder(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'monaco-sp4-migrations-'));
  cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
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

async function insertRole(tenantId: string, key: string | null, name: string, permissions: readonly string[]) {
  const { rows } = await target.query<{ id: string }>(
    `insert into roles (id, tenant_id, key, name, is_system) values (gen_random_uuid(), $1, $2, $3, $4) returning id`,
    [tenantId, key, name, key !== null],
  );
  for (const permission of permissions) {
    await target.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, $2, $3)`, [rows[0]!.id, permission, tenantId]);
  }
}

/** A tenant as the SP3 code created it: SP3 system roles plus the custom roles. */
async function seedSp3Tenant(tenantId: string, slug: string) {
  await target.query(`insert into tenants (id, name, slug) values ($1, $2, $2)`, [tenantId, slug]);
  for (const [key, permissions] of Object.entries(SP3_SYSTEM_ROLES)) await insertRole(tenantId, key, key, permissions);
  for (const [name, permissions] of Object.entries(CUSTOM_ROLES)) await insertRole(tenantId, null, name, permissions);
}

async function permissionsOf(tenantId: string, system: boolean): Promise<Record<string, string[]>> {
  const { rows } = await target.query<{ name: string; permissions: string[] }>(
    `select coalesce(r.key, r.name) as name, array_agg(rp.permission order by rp.permission) as permissions
       from roles r join role_permissions rp on rp.role_id = r.id and rp.tenant_id = r.tenant_id
      where r.tenant_id = $1 and r.is_system = $2 group by 1`,
    [tenantId, system],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.permissions]));
}

const sorted = (record: Record<string, readonly string[]>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, [...v].sort()]));
const EXPECTED_SYSTEM = Object.fromEntries(Object.values(SYSTEM_ROLES).map((spec) => [spec.key, [...spec.permissions].sort()]));

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
  // afterAll drops this database `with (force)` while an ended client may still be closing (57P01).
  target.on('error', () => undefined);
  await target.query(initSql);
  preFolder = partialFolder(PRE_SP4_MIGRATIONS);
  await migrateAsOwner(preFolder);
  await seedSp3Tenant(TENANT_OLD, 'sp3-tenant');
  policiesBefore = await policies();
  owner = new Pool({ connectionString: urlFor(urls().owner), max: 1 });
  // afterAll drops this database `with (force)` while an ended client may still be closing (57P01).
  owner.on('error', () => undefined);
});
afterAll(async () => {
  await owner.end();
  await target.end();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.end();
  rmSync(preFolder, { recursive: true, force: true });
});

describe('SP4 data migration of the system roles (D4, SP3·D11 procedure)', () => {
  it('the pre-SP4 journal stops right before the two SP4 migrations', () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.slice(PRE_SP4_MIGRATIONS, PRE_SP4_MIGRATIONS + 2).map((e) => e.tag)).toEqual([
      '0012_sp4_permission_catalog_check',
      MIGRATION_FILE.replace('.sql', ''),
    ]);
  });

  it('before it, the SP3 tenant has the SP3 roles and the CHECK rejects reports:view_own', async () => {
    expect(await permissionsOf(TENANT_OLD, true)).toEqual(sorted(SP3_SYSTEM_ROLES));
    await expect(
      target.query(`insert into role_permissions (role_id, permission, tenant_id) select id, 'reports:view_own', tenant_id from roles where tenant_id = $1 limit 1`, [TENANT_OLD]),
    ).rejects.toThrow(/role_permissions_permission_check/);
    expect(await forceState()).toEqual(FORCED);
  });

  it('system roles created before SP4 end equal to SYSTEM_ROLES: Cashier + reports:view_own − reports:view, Manager + reports:view_own', async () => {
    await migrateAsOwner(migrationsFolder);
    const actual = await permissionsOf(TENANT_OLD, true);
    expect(actual).toEqual(EXPECTED_SYSTEM);
    expect(actual.cashier).toContain('reports:view_own');
    expect(actual.cashier).not.toContain('reports:view');
    expect(actual.owner).toContain('reports:view_own');
    expect(actual.manager).toEqual([...SP3_SYSTEM_ROLES.manager, 'reports:view_own'].sort());
    expect(actual.manager).toContain('reports:view');
  });

  it('never touches a custom role, even one with reports:view', async () => {
    expect(await permissionsOf(TENANT_OLD, false)).toEqual(sorted(CUSTOM_ROLES));
  });

  it('keeps FORCE ROW LEVEL SECURITY on roles and role_permissions, and every policy intact', async () => {
    expect(await forceState()).toEqual(FORCED);
    expect(await policies()).toEqual(policiesBefore);
  });

  it('runs twice: a second (and third) run is a no-op and FORCE is still on', async () => {
    const snapshot = async () =>
      (await target.query(`select role_id, permission, tenant_id from role_permissions order by 1, 2`)).rows;
    const before = await snapshot();
    await runDataMigration();
    await runDataMigration();
    expect(await snapshot()).toEqual(before);
    expect(await forceState()).toEqual(FORCED);
  });

  it('is re-runnable: a tenant created later by the SP3 code is fixed by running it again', async () => {
    await seedSp3Tenant(TENANT_LATE, 'late-tenant');
    expect((await permissionsOf(TENANT_LATE, true)).cashier).toContain('reports:view');
    await runDataMigration();
    expect(await permissionsOf(TENANT_LATE, true)).toEqual(EXPECTED_SYSTEM);
    expect(await permissionsOf(TENANT_LATE, false)).toEqual(sorted(CUSTOM_ROLES));
    expect(await permissionsOf(TENANT_OLD, true)).toEqual(EXPECTED_SYSTEM);
    expect(await forceState()).toEqual(FORCED);
  });

  it('a failure inside the transaction rolls back the NO FORCE and the delete too', async () => {
    await target.query(
      `insert into role_permissions (role_id, permission, tenant_id)
       select id, 'reports:view', tenant_id from roles where tenant_id = $1 and key = 'cashier'`,
      [TENANT_OLD],
    );
    await expect(runDataMigration(`select 1/0`)).rejects.toThrow(/division by zero/);
    expect((await permissionsOf(TENANT_OLD, true)).cashier).toContain('reports:view');
    expect(await forceState()).toEqual(FORCED);
    await runDataMigration();
    expect(await permissionsOf(TENANT_OLD, true)).toEqual(EXPECTED_SYSTEM);
  });

  it('monaco_app still sees no role rows without a tenant context', async () => {
    const app = new Pool({ connectionString: urlFor(urls().app), max: 1 });
    try {
      expect((await app.query('select count(*)::int as n from role_permissions')).rows).toEqual([{ n: 0 }]);
    } finally {
      await app.end();
    }
  });
});
