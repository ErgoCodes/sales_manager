import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEvents, roleAssignments } from '../../src/infrastructure/db/schema';
import { withTenant } from '../../src/infrastructure/db/with-tenant';
import { adminPool, appDatabase, rejection, resetTenants, TENANT_A, TENANT_B, urls } from './helpers';

const { pool: appPool, db } = appDatabase(1);
let admin: Pool;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** One user, role, location, assignment, device and refresh token per tenant (as superuser). */
type Fixture = { user: string; role: string; location: string; assignment: string; device: string; email: string; token: Buffer };
const fixture: Record<'a' | 'b', Fixture> = {} as never;

async function seed() {
  await admin.query(`insert into tenants (id, name, slug) values ($1, 'A', 'a'), ($2, 'B', 'b')`, [TENANT_A, TENANT_B]);
  for (const [key, tenant] of [
    ['a', TENANT_A],
    ['b', TENANT_B],
  ] as const) {
    const f: Fixture = {
      user: randomUUID(),
      role: randomUUID(),
      location: randomUUID(),
      assignment: randomUUID(),
      device: randomUUID(),
      email: `owner-${key}@example.com`,
      token: sha256(`token-${key}`),
    };
    fixture[key] = f;
    await admin.query(
      `insert into users (id, tenant_id, email, display_name, password_hash) values ($1, $2, $3, 'Owner', $4)`,
      [f.user, tenant, f.email, `hash-${key}`],
    );
    await admin.query(`insert into roles (id, tenant_id, key, name, is_system) values ($1, $2, 'owner', 'Owner', true)`, [f.role, tenant]);
    await admin.query(`insert into locations (id, tenant_id, name, code) values ($1, $2, 'Main', 'main')`, [f.location, tenant]);
    await admin.query(`insert into role_assignments (id, tenant_id, user_id, role_id, scope) values ($1, $2, $3, $4, 'locations')`, [
      f.assignment,
      tenant,
      f.user,
      f.role,
    ]);
    await admin.query(`insert into devices (id, tenant_id, user_id, label, platform) values ($1, $2, $3, 'Laptop', 'web')`, [
      f.device,
      tenant,
      f.user,
    ]);
    await admin.query(
      `insert into refresh_tokens (id, tenant_id, device_id, family_id, token_hash, expires_at, absolute_expires_at)
       values (gen_random_uuid(), $1, $2, gen_random_uuid(), $3, now() + interval '30 days', now() + interval '90 days')`,
      [tenant, f.device, f.token],
    );
  }
}

beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await appPool.end();
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
  await seed();
});

describe('composite FKs keep references inside the tenant', () => {
  // Each insert runs as superuser (no RLS at all) with tenant A's tenant_id
  // and a parent that belongs to tenant B: only the composite FK stops it.
  const crossTenant: [string, (b: Fixture) => [string, unknown[]]][] = [
    ['role_permissions -> roles', (b) => [`insert into role_permissions (role_id, permission, tenant_id) values ($1, 'sales:create', $2)`, [b.role]]],
    [
      'role_assignments -> users',
      (b) => [`insert into role_assignments (id, tenant_id, user_id, role_id, scope) values (gen_random_uuid(), $2, $1, (select id from roles where tenant_id = $2), 'tenant')`, [b.user]],
    ],
    [
      'role_assignments -> roles',
      (b) => [`insert into role_assignments (id, tenant_id, user_id, role_id, scope) values (gen_random_uuid(), $2, (select id from users where tenant_id = $2), $1, 'tenant')`, [b.role]],
    ],
    [
      'role_assignment_locations -> role_assignments',
      (b) => [`insert into role_assignment_locations (assignment_id, location_id, tenant_id) values ($1, (select id from locations where tenant_id = $2), $2)`, [b.assignment]],
    ],
    [
      'role_assignment_locations -> locations',
      (b) => [`insert into role_assignment_locations (assignment_id, location_id, tenant_id) values ((select id from role_assignments where tenant_id = $2), $1, $2)`, [b.location]],
    ],
    ['devices -> users', (b) => [`insert into devices (id, tenant_id, user_id, label, platform) values (gen_random_uuid(), $2, $1, 'x', 'web')`, [b.user]]],
    [
      'refresh_tokens -> devices',
      (b) => [
        `insert into refresh_tokens (id, tenant_id, device_id, family_id, token_hash, expires_at, absolute_expires_at)
         values (gen_random_uuid(), $2, $1, gen_random_uuid(), sha256('x'::bytea), now(), now())`,
        [b.device],
      ],
    ],
    ['audit_events -> users (actor)', (b) => [`insert into audit_events (id, tenant_id, actor_user_id, type) values (gen_random_uuid(), $2, $1, 'x')`, [b.user]]],
  ];

  it.each(crossTenant)('%s rejects a parent from another tenant', async (_name, build) => {
    const [statement, params] = build(fixture.b);
    const error = await rejection(admin.query(statement, [...params, TENANT_A]));
    expect(error.code).toBe('23503');
  });

  it('gives monaco_app the same error for another tenant id and a nonexistent one (no existence oracle)', async () => {
    const assign = (roleId: string) =>
      rejection(
        withTenant(db, TENANT_A, (tx) =>
          tx.insert(roleAssignments).values({ tenantId: TENANT_A, userId: fixture.a.user, roleId, scope: 'tenant' }),
        ),
      );
    const foreign = await assign(fixture.b.role);
    const missing = await assign(randomUUID());
    expect(foreign.code).toBe('23503');
    expect(missing.code).toBe('23503');
    expect(foreign.constraint).toBe(missing.constraint);
  });

  it('accepts references inside the same tenant', async () => {
    await withTenant(db, TENANT_A, (tx) =>
      tx.execute(sql`insert into role_permissions (role_id, permission, tenant_id) values (${fixture.a.role}, 'sales:create', ${TENANT_A})`),
    );
  });

  it('only accepts permissions shaped resource:action', async () => {
    for (const permission of ['sales', 'Sales:create', 'sales:create:x', 'sales:*', '']) {
      const error = await rejection(
        admin.query(`insert into role_permissions (role_id, permission, tenant_id) values ($1, $2, $3)`, [fixture.a.role, permission, TENANT_A]),
      );
      expect(error.code, permission).toBe('23514');
    }
  });

  it('keeps emails unique across tenants, case-insensitively', async () => {
    const error = await rejection(
      admin.query(`insert into users (id, tenant_id, email, display_name, password_hash) values (gen_random_uuid(), $1, $2, 'x', 'x')`, [
        TENANT_B,
        fixture.a.email.toUpperCase(),
      ]),
    );
    expect(error.code).toBe('23505');
  });
});

describe('auth_lookup_user / auth_lookup_refresh (SECURITY DEFINER)', () => {
  const lookupUser = (email: string | null) => appPool.query('select * from auth_lookup_user($1)', [email]);
  const lookupRefresh = (hash: Buffer | null) => appPool.query('select * from auth_lookup_refresh($1)', [hash]);

  it('are owned by monaco_auth, SECURITY DEFINER, with a fixed search_path', async () => {
    const { rows } = await admin.query(
      `select p.proname, p.proowner::regrole::text as owner, p.prosecdef, p.proconfig
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'auth\\_%' order by p.proname`,
    );
    expect(rows).toEqual([
      { proname: 'auth_lookup_refresh', owner: 'monaco_auth', prosecdef: true, proconfig: ['search_path=pg_catalog, public'] },
      { proname: 'auth_lookup_user', owner: 'monaco_auth', prosecdef: true, proconfig: ['search_path=pg_catalog, public'] },
    ]);
  });

  it('grant EXECUTE to monaco_app only: not PUBLIC, not monaco_owner', async () => {
    const { rows } = await admin.query(
      `select p.proname, array_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end order by a.grantee::regrole::text) as grantees
       from pg_proc p, aclexplode(p.proacl) a
       where p.proname in ('auth_lookup_user', 'auth_lookup_refresh') and a.privilege_type = 'EXECUTE'
       group by p.proname order by p.proname`,
    );
    // proacl is never NULL here (NULL would mean the default: EXECUTE for PUBLIC).
    expect(rows).toEqual([
      { proname: 'auth_lookup_refresh', grantees: ['monaco_app', 'monaco_auth'] },
      { proname: 'auth_lookup_user', grantees: ['monaco_app', 'monaco_auth'] },
    ]);
    const owner = new Pool({ connectionString: urls().owner, max: 1 });
    try {
      await expect(owner.query('select * from auth_lookup_user($1)', [fixture.a.email])).rejects.toThrow(/permission denied/i);
      await expect(owner.query('select * from auth_lookup_refresh($1)', [fixture.a.token])).rejects.toThrow(/permission denied/i);
    } finally {
      await owner.end();
    }
  });

  it('auth_lookup_user finds a user of any tenant without withTenant, returning only id, tenant_id, password_hash, status', async () => {
    const result = await lookupUser(fixture.b.email);
    expect(result.fields.map((field) => field.name)).toEqual(['id', 'tenant_id', 'password_hash', 'status']);
    expect(result.rows).toEqual([{ id: fixture.b.user, tenant_id: TENANT_B, password_hash: 'hash-b', status: 'active' }]);
    // citext: equality ignores case, nothing else.
    expect((await lookupUser(fixture.a.email.toUpperCase())).rows).toHaveLength(1);
  });

  it.each(['%', '_%', 'owner-%', '%@example.com', 'owner-_@example.com', "' or '1'='1", "x' or true --", ' owner-a@example.com', ''])(
    'auth_lookup_user(%j) matches nothing (exact equality, no pattern or injection)',
    async (email) => {
      expect((await lookupUser(email)).rows).toEqual([]);
    },
  );

  it('auth_lookup_user(NULL) returns no row', async () => {
    expect((await lookupUser(null)).rows).toEqual([]);
  });

  it('auth_lookup_refresh returns tenant, device, family and state for the exact hash only', async () => {
    const result = await lookupRefresh(fixture.a.token);
    expect(result.fields.map((field) => field.name)).toEqual([
      'tenant_id',
      'device_id',
      'family_id',
      'expires_at',
      'absolute_expires_at',
      'rotated_at',
      'revoked_at',
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ tenant_id: TENANT_A, device_id: fixture.a.device, rotated_at: null, revoked_at: null });
    expect((await lookupRefresh(sha256('unknown'))).rows).toEqual([]);
    expect((await lookupRefresh(fixture.a.token.subarray(0, 16))).rows).toEqual([]);
    expect((await lookupRefresh(null)).rows).toEqual([]);
  });

  it('return at most one row by construction (unique key + LIMIT 1) and never match by pattern', async () => {
    const { rows } = await admin.query(
      `select proname, proretset from pg_proc where proname in ('auth_lookup_user', 'auth_lookup_refresh') order by proname`,
    );
    expect(rows.every((row) => row.proretset)).toBe(true);
    const { rows: defs } = await admin.query(
      `select pg_get_functiondef(oid) as def from pg_proc where proname in ('auth_lookup_user', 'auth_lookup_refresh')`,
    );
    for (const { def } of defs) {
      expect(def).toMatch(/LIMIT 1/);
      expect(def).not.toMatch(/\bI?LIKE\b|\bSIMILAR\b| ~/i);
    }
  });

  it('do not depend on the caller search_path', async () => {
    const client = await appPool.connect();
    try {
      await client.query('begin');
      // Without public on the path, unqualified users/citext would not resolve.
      await client.query("set local search_path = pg_temp");
      const { rows } = await client.query('select * from public.auth_lookup_user($1)', [fixture.a.email]);
      expect(rows).toHaveLength(1);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('audit_events is append-only for monaco_app', () => {
  it('can insert and read its own tenant events', async () => {
    await withTenant(db, TENANT_A, (tx) => tx.insert(auditEvents).values({ tenantId: TENANT_A, actorUserId: fixture.a.user, type: 'login.succeeded' }));
    const rows = await withTenant(db, TENANT_A, (tx) => tx.select().from(auditEvents));
    expect(rows.map((row) => row.type)).toEqual(['login.succeeded']);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('cannot update or delete events', async () => {
    await admin.query(`insert into audit_events (id, tenant_id, type) values (gen_random_uuid(), $1, 'x')`, [TENANT_A]);
    const update = await rejection(withTenant(db, TENANT_A, (tx) => tx.update(auditEvents).set({ type: 'tampered' })));
    expect(update.message).toMatch(/permission denied for table audit_events/);
    const remove = await rejection(withTenant(db, TENANT_A, (tx) => tx.delete(auditEvents)));
    expect(remove.message).toMatch(/permission denied for table audit_events/);
    expect((await admin.query(`select type from audit_events`)).rows).toEqual([{ type: 'x' }]);
  });
});
