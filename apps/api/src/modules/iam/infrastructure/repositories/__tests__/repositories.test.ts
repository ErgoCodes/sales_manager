import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { TenantTransaction, Transaction } from '../../../../../infrastructure/db/with-tenant';
import { DrizzleTenantUnitOfWork } from '../../drizzle-tenant-unit-of-work';
import { toBytea, toDate } from '../../sql-helpers';
import { ActorStateRepository } from '../actor-state.repository';
import { AuditRepository } from '../audit.repository';
import { DevicesRepository } from '../devices.repository';
import { RefreshTokensRepository } from '../refresh-tokens.repository';
import { TenantsRepository } from '../tenants.repository';
import { UsersRepository } from '../users.repository';

// The SQL itself runs against Postgres in test/integration (auth.e2e.test.ts);
// here we check the mapping and that every statement is parameterized.
const dialect = new PgDialect();
const TENANT = '0190a000-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-05T12:00:00Z');

function fakeTx(...results: unknown[][]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    return { rows: results.shift() ?? [] };
  });
  return { tx: { execute } as unknown as TenantTransaction, queries };
}

describe('sql helpers', () => {
  it('converts to Buffer and Date', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    expect(toBytea(bytes)).toEqual(Buffer.from([2, 3]));
    expect(toDate('2026-11-05T12:00:00Z')).toEqual(NOW);
    expect(toDate(null)).toBeNull();
  });
});

describe('tenant-scoped transactions (type-level guard, checked by `pnpm typecheck`)', () => {
  it('repositories reject a transaction that withTenant did not open', () => {
    const plain = {} as Transaction;
    // @ts-expect-error a plain Transaction is not a TenantTransaction
    expect(new UsersRepository(plain)).toBeInstanceOf(UsersRepository);
  });
});

describe('UsersRepository', () => {
  it('finds by id converting dates, and sets a chosen password', async () => {
    const { tx, queries } = fakeTx([{ id: 'u', passwordExpiresAt: '2026-11-05T12:00:00Z' }], [], []);
    const repo = new UsersRepository(tx);
    expect(await repo.findById('u')).toEqual({ id: 'u', passwordExpiresAt: NOW });
    expect(await repo.findById('x')).toBeNull();
    await repo.setPassword('u', 'hash');
    expect(queries[2]).toMatchObject({ params: ['hash', 'u'] });
    expect(queries[2]!.sql).toMatch(/must_change_password = false, password_expires_at = null/);
  });
});

describe('TenantsRepository', () => {
  it('reads the only visible tenant', async () => {
    const { tx } = fakeTx([{ id: TENANT, name: 'A', slug: 'a' }], []);
    const repo = new TenantsRepository(tx);
    expect(await repo.findCurrent()).toEqual({ id: TENANT, name: 'A', slug: 'a' });
    expect(await repo.findCurrent()).toBeNull();
  });
});

describe('DevicesRepository', () => {
  it('finds, creates (with the tenant), touches and revokes', async () => {
    const { tx, queries } = fakeTx([{ id: 'd' }], [], [], [], [{ id: 'd2' }, { id: 'd3' }]);
    const repo = new DevicesRepository(tx, TENANT);
    expect(await repo.findActive('d', 'u')).toEqual({ id: 'd' });
    expect(await repo.findActive('d', 'u')).toBeNull();
    const id = await repo.create({ userId: 'u', label: 'Phone', platform: 'ios', now: NOW });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(queries[2]!.params).toEqual([id, TENANT, 'u', 'Phone', 'ios', NOW, NOW]);
    await repo.touch('d', NOW);
    expect(await repo.revokeAllExcept('u', 'd', NOW)).toEqual(['d2', 'd3']);
  });
});

describe('RefreshTokensRepository', () => {
  it('starts families, appends, locks, rotates and revokes', async () => {
    const row = {
      id: 'r',
      expiresAt: '2026-11-05T12:00:00Z',
      absoluteExpiresAt: '2026-11-05T12:00:00Z',
      rotatedAt: null,
      revokedAt: null,
      deviceRevokedAt: null,
    };
    // Results in statement order; statements without a listed result get [].
    const { tx, queries } = fakeTx([], [{ deviceId: 'd' }], [], [row], [], [], [{ deviceId: 'd' }], [], [], [], [], [], []);
    const repo = new RefreshTokensRepository(tx, TENANT);
    const token = { deviceId: 'd', tokenHash: new Uint8Array(32), expiresAt: NOW, absoluteExpiresAt: NOW, now: NOW };

    const family = await repo.startFamily(token);
    expect(queries[0]!.params.slice(1, 5)).toEqual([TENANT, 'd', family, Buffer.alloc(32)]);

    // findForUpdate: owner device, device lock, then the token row lock.
    expect(await repo.findForUpdate(new Uint8Array(32))).toMatchObject({ id: 'r', expiresAt: NOW, absoluteExpiresAt: NOW, rotatedAt: null });
    expect(queries[2]!.sql).toMatch(/from devices where id = any\(\$1::uuid\[\]\) order by id for no key update$/);
    expect(queries[2]!.params).toEqual([['d']]);
    expect(queries[3]!.sql).toMatch(/for update of r$/);
    // Unknown token: no lock at all.
    expect(await repo.findForUpdate(new Uint8Array(32))).toBeNull();
    expect(queries).toHaveLength(5);

    await repo.markRotated('r', NOW);
    // revokeFamily: the family's devices, their lock, then the UPDATE.
    await repo.revokeFamily(family, 'logout', NOW);
    expect(queries[7]!.params).toEqual([['d']]);
    expect(queries[8]!.sql).toMatch(/^update refresh_tokens/);
    await repo.revokeByDevices(['d1', 'd2'], 'password_changed', NOW);
    expect(queries[9]!.params).toEqual([['d1', 'd2']]);
    expect(queries[10]!.params).toEqual([NOW, 'password_changed', ['d1', 'd2']]);
    await repo.revokeByDevices([], 'password_changed', NOW);
    expect(queries).toHaveLength(11);
    // A family with no tokens locks nothing.
    await repo.revokeFamily(family, 'logout', NOW);
    expect(queries).toHaveLength(13);
    await repo.append(family, token);
    expect(queries[13]!.params[3]).toBe(family);
  });
});

describe('AuditRepository', () => {
  it('inserts with the tenant, defaults and JSON metadata', async () => {
    const { tx, queries } = fakeTx([], []);
    const repo = new AuditRepository(tx, TENANT);
    await repo.record({ type: 'login_failed', actorUserId: null, ip: null });
    expect(queries[0]!.params.slice(1)).toEqual([TENANT, null, 'login_failed', null, null, '{}', null]);
    await repo.record({ type: 'login_succeeded', actorUserId: 'u', targetType: 'device', targetId: 'd', metadata: { a: 1 }, ip: '10.0.0.1' });
    expect(queries[1]!.params.slice(1)).toEqual([TENANT, 'u', 'login_succeeded', 'device', 'd', '{"a":1}', '10.0.0.1']);
  });
});

describe('ActorStateRepository', () => {
  it('maps the single per-request query and drops permissions outside the catalog', async () => {
    const { tx, queries } = fakeTx(
      [
        {
          status: 'active',
          mustChangePassword: false,
          deviceActive: true,
          sessionActive: true,
          assignments: [{ roleId: 'r', roleKey: null, isSystem: false, scope: 'tenant', permissions: ['sales:create', 'bogus:perm'], locationIds: [] }],
        },
      ],
      [{ status: 'disabled', mustChangePassword: true, deviceActive: false, sessionActive: false, assignments: [] }],
      [],
    );
    const repo = new ActorStateRepository(tx);
    expect(await repo.load('u', 'd', 's')).toEqual({
      userActive: true,
      mustChangePassword: false,
      deviceActive: true,
      sessionActive: true,
      assignments: [{ roleId: 'r', roleKey: null, isSystem: false, scope: 'tenant', permissions: ['sales:create'], locationIds: [] }],
    });
    expect(queries[0]!.params).toEqual(['s', 'd', 'u']);
    expect(await repo.load('u', 'd', 's')).toMatchObject({ userActive: false });
    expect(await repo.load('u', 'd', 's')).toBeNull();
    expect(queries).toHaveLength(3);
  });
});

describe('DrizzleTenantUnitOfWork', () => {
  it('scopes the transaction to the tenant and hands out repositories bound to it', async () => {
    const { tx, queries } = fakeTx([], [{ id: TENANT, name: 'A', slug: 'a' }]);
    const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const uow = new DrizzleTenantUnitOfWork(db as never);
    const tenant = await uow.run(TENANT, (scope) => {
      expect(Object.keys(scope).sort()).toEqual(['actors', 'audit', 'devices', 'refreshTokens', 'tenants', 'users']);
      return scope.tenants.findCurrent();
    });
    expect(tenant).toEqual({ id: TENANT, name: 'A', slug: 'a' });
    expect(queries[0]!.params).toEqual(['app.tenant_id', TENANT]);
  });
});
