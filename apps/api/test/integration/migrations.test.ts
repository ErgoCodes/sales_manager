import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPool, urls } from './helpers';

const apiRoot = resolve(__dirname, '../..');
const migrationsFolder = resolve(apiRoot, 'drizzle');
const initSql = readFileSync(resolve(apiRoot, '../../infra/postgres/init.sql'), 'utf8');
const DATABASE = 'monaco_upgrade';
const SP1_MIGRATIONS = 2;

const urlFor = (base: string) => {
  const url = new URL(base);
  url.pathname = `/${DATABASE}`;
  return url.toString();
};

/** A copy of the migrations folder that stops after the first `count` entries. */
function partialFolder(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'monaco-migrations-'));
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

let admin: Pool;
let target: Pool;
let sp1Folder: string;

beforeAll(async () => {
  admin = adminPool();
  await admin.query(`drop database if exists ${DATABASE}`);
  await admin.query(`create database ${DATABASE}`);
  target = new Pool({ connectionString: urlFor(urls().admin), max: 1 });
  sp1Folder = partialFolder(SP1_MIGRATIONS);
});
afterAll(async () => {
  await target.end();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.end();
  rmSync(sp1Folder, { recursive: true, force: true });
});

describe('migrations on a database that already has the SP1 schema', () => {
  it('init.sql is idempotent: it runs again on an existing cluster', async () => {
    await target.query(initSql);
    await target.query(initSql);
  });

  it('applies the SP1 migrations, then refuses SP2 until monaco_owner can SET ROLE monaco_auth', async () => {
    await migrateAsOwner(sp1Folder);
    await target.query(`insert into _tenancy_probe (tenant_id, label) values (gen_random_uuid(), 'old')`);

    // Simulates a cluster bootstrapped by the SP1 init.sql (roles are cluster-wide).
    await admin.query('revoke monaco_auth from monaco_owner');
    try {
      await expect(migrateAsOwner(migrationsFolder)).rejects.toThrow(/cannot SET ROLE monaco_auth/);
      // The whole run is one transaction: nothing of SP2 was half-applied.
      expect((await target.query(`select to_regclass('public.users') as users, to_regclass('public._tenancy_probe') as probe`)).rows).toEqual([
        { users: null, probe: '_tenancy_probe' },
      ]);
    } finally {
      // The documented fix: run init.sql again as superuser.
      await target.query(initSql);
    }
  });

  it('then upgrades to SP2: drops the probe, creates the IAM schema and the auth functions', async () => {
    await migrateAsOwner(migrationsFolder);
    const { rows } = await target.query(
      `select to_regclass('public._tenancy_probe') as probe,
              (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
                 and relrowsecurity and relforcerowsecurity) as forced,
              (select array_agg(proowner::regrole::text) from pg_proc
                 where proname like 'auth\\_lookup\\_%' or proname = 'rate_limit_hit') as owners`,
    );
    // 10 IAM tables + rate_limits (SP2·T3); 2 auth lookups + rate_limit_hit.
    expect(rows).toEqual([{ probe: null, forced: 11, owners: ['monaco_auth', 'monaco_auth', 'monaco_auth'] }]);
    // monaco_auth only needed CREATE on public while the migration ran.
    expect((await target.query(`select has_schema_privilege('monaco_auth', 'public', 'CREATE') as can`)).rows).toEqual([{ can: false }]);
  });

  it('is a no-op when run again', async () => {
    const count = async () => (await target.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n;
    const before = await count();
    await migrateAsOwner(migrationsFolder);
    expect(await count()).toBe(before);
  });
});
