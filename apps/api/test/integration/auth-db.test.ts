import { PERMISSIONS } from '@monaco/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminPool, resetTenants, seedTenants, TENANT_A, urls } from './helpers';

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
beforeEach(async () => {
  await admin.query('truncate table rate_limits');
});

type Hit = { total_hits: number; time_to_expire_ms: string; is_blocked: boolean; time_to_block_expire_ms: string };
const hit = async (key: string, ttl = 60_000, limit = 2, block = 1_000, maxBlock = 3_000) =>
  (await app.query<Hit>('select * from rate_limit_hit($1, $2, $3, $4, $5)', [key, ttl, limit, block, maxBlock])).rows[0]!;

describe('role_permissions CHECK (SP2·T3, review of T1)', () => {
  it('lists exactly the PERMISSIONS catalog of @monaco/contracts', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'role_permissions_permission_check'`,
    );
    const values = [...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((match) => match[1]);
    // Adding a permission to the catalog without a migration fails here.
    expect(values.sort()).toEqual([...PERMISSIONS].sort());
  });

  it('rejects a permission outside the catalog', async () => {
    await resetTenants(admin);
    await seedTenants(admin);
    const { rows } = await admin.query<{ id: string }>(`select id from roles where tenant_id = $1 limit 1`, [TENANT_A]);
    await expect(
      admin.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, 'sales:refund', $2)`, [rows[0]!.id, TENANT_A]),
    ).rejects.toThrow(/role_permissions_permission_check/);
    await resetTenants(admin);
  });
});

describe('tenants privileges (SP2·T3, review of T1)', () => {
  it('monaco_app can only UPDATE tenants.name, which is enough for SELECT ... FOR UPDATE', async () => {
    const { rows } = await admin.query<{ column: string; privilege: string }>(
      `select column_name as column, privilege_type as privilege from information_schema.column_privileges
       where table_name = 'tenants' and grantee = 'monaco_app' and privilege_type = 'UPDATE'`,
    );
    expect(rows).toEqual([{ column: 'name', privilege: 'UPDATE' }]);

    await resetTenants(admin);
    await seedTenants(admin);
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      expect((await client.query('select 1 from tenants where id = $1 for update', [TENANT_A])).rowCount).toBe(1);
      await expect(client.query(`update tenants set slug = 'hijack' where id = $1`, [TENANT_A])).rejects.toThrow(/permission denied/i);
      await client.query('rollback');
    } finally {
      client.release();
      await resetTenants(admin);
    }
  });
});

describe('rate_limits store (ADR 0004)', () => {
  it('is forced RLS with no policy, and monaco_app has no privilege on it', async () => {
    const { rows } = await admin.query(
      `select relrowsecurity, relforcerowsecurity, (select count(*)::int from pg_policies where tablename = 'rate_limits') as policies
       from pg_class where relname = 'rate_limits'`,
    );
    expect(rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true, policies: 0 }]);
    await expect(app.query('select * from rate_limits')).rejects.toThrow(/permission denied/i);
    await expect(app.query(`insert into rate_limits (key, hits, window_expires_at) values ('k', 0, now())`)).rejects.toThrow(/permission denied/i);
  });

  it('rate_limit_hit is SECURITY DEFINER, owned by monaco_auth, with a fixed search_path and EXECUTE only for monaco_app', async () => {
    const { rows } = await admin.query(
      `select p.prosecdef, p.proowner::regrole::text as owner, p.proconfig,
              has_function_privilege('monaco_owner', p.oid, 'EXECUTE') as owner_exec,
              has_function_privilege('monaco_app', p.oid, 'EXECUTE') as app_exec,
              exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_exec
       from pg_proc p where p.proname = 'rate_limit_hit'`,
    );
    expect(rows).toEqual([
      { prosecdef: true, owner: 'monaco_auth', proconfig: ['search_path=pg_catalog, public'], owner_exec: false, app_exec: true, public_exec: false },
    ]);
  });

  it('counts hits in a window, blocks over the limit and doubles each consecutive block up to the cap', async () => {
    expect(await hit('k1')).toMatchObject({ total_hits: 1, is_blocked: false });
    expect(await hit('k1')).toMatchObject({ total_hits: 2, is_blocked: false });
    const first = await hit('k1');
    expect(first).toMatchObject({ total_hits: 3, is_blocked: true });
    expect(Number(first.time_to_block_expire_ms)).toBeGreaterThan(900);
    expect(Number(first.time_to_block_expire_ms)).toBeLessThanOrEqual(1_000);
    // While blocked, hits are not counted.
    expect(await hit('k1')).toMatchObject({ total_hits: 3, is_blocked: true });

    // Second strike: once the block is over, a fresh window; exceeding it again blocks for 2x.
    await admin.query(`update rate_limits set blocked_until = now() - interval '1 ms' where key = 'k1'`);
    await hit('k1');
    await hit('k1');
    const second = await hit('k1');
    expect(second.is_blocked).toBe(true);
    expect(Number(second.time_to_block_expire_ms)).toBeGreaterThan(1_900);

    // Third and fourth strikes are capped at maxBlock (3 s), never a permanent lock.
    for (let strike = 0; strike < 2; strike++) {
      await admin.query(`update rate_limits set blocked_until = now() - interval '1 ms' where key = 'k1'`);
      await hit('k1');
      await hit('k1');
      const capped = await hit('k1');
      expect(Number(capped.time_to_block_expire_ms)).toBeLessThanOrEqual(3_000);
      expect(Number(capped.time_to_block_expire_ms)).toBeGreaterThan(2_900);
    }
    expect((await admin.query(`select strikes from rate_limits where key = 'k1'`)).rows).toEqual([{ strikes: 4 }]);
  });

  it('keys are independent, windows reset, and strikes decay', async () => {
    await hit('a');
    expect(await hit('b')).toMatchObject({ total_hits: 1 });
    await admin.query(`update rate_limits set window_expires_at = now() - interval '1 ms', strikes = 3, strikes_expire_at = now() - interval '1 ms' where key = 'a'`);
    expect(await hit('a')).toMatchObject({ total_hits: 1, is_blocked: false });
    expect((await admin.query(`select strikes from rate_limits where key = 'a'`)).rows).toEqual([{ strikes: 0 }]);
  });

  it('without a block duration it only reports hits over the limit', async () => {
    await hit('nb', 60_000, 1, 0, 0);
    expect(await hit('nb', 60_000, 1, 0, 0)).toMatchObject({ total_hits: 2, is_blocked: true, time_to_block_expire_ms: '0' });
  });

  it('rejects invalid arguments', async () => {
    await expect(hit('', 1000)).rejects.toThrow(/invalid arguments/);
    await expect(hit('x', 0)).rejects.toThrow(/invalid arguments/);
    await expect(hit('x'.repeat(129))).rejects.toThrow(/invalid arguments/);
  });
});
