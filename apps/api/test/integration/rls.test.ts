import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { roles, tenants } from '../../src/infrastructure/db/schema';
import { withTenant } from '../../src/infrastructure/db/with-tenant';
import { adminPool, appDatabase, expectRlsViolation, rejection, resetTenants, seedTenants, TENANT_A, TENANT_B } from './helpers';

const { pool: appPool, db } = appDatabase(1);
let admin: Pool;

// SP1 proved RLS on a probe table; SP2 dropped it, so the same cases run on a
// real tenant-owned table with full DML for the app (roles).
const labels = (rows: { name: string }[]) => rows.map((row) => row.name).sort();
const adminLabels = async (tenant: string) =>
  labels((await admin.query<{ name: string }>('select name from roles where tenant_id = $1', [tenant])).rows);

beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await appPool.end();
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
  await seedTenants(admin);
});

describe('RLS on a tenant-owned table (roles), connected as monaco_app', () => {
  it('connects as the unprivileged runtime role', async () => {
    const { rows } = await appPool.query('select current_user, usesuper, usebypassrls from pg_user where usename = current_user');
    expect(rows[0]).toMatchObject({ current_user: 'monaco_app', usesuper: false, usebypassrls: false });
  });

  it('shows only the current tenant rows inside withTenant', async () => {
    expect(labels(await withTenant(db, TENANT_A, (tx) => tx.select().from(roles)))).toEqual(['a1', 'a2']);
    expect(labels(await withTenant(db, TENANT_B, (tx) => tx.select().from(roles)))).toEqual(['b1']);
  });

  it('shows nothing without withTenant', async () => {
    expect(await db.select().from(roles)).toEqual([]);
    expect((await appPool.query('select 1 from roles')).rowCount).toBe(0);
  });

  it('rejects an insert for another tenant (WITH CHECK) and accepts one for its own', async () => {
    await expectRlsViolation(withTenant(db, TENANT_A, (tx) => tx.insert(roles).values({ tenantId: TENANT_B, name: 'evil' })));
    await withTenant(db, TENANT_A, (tx) => tx.insert(roles).values({ tenantId: TENANT_A, name: 'a3' }));
    expect(await adminLabels(TENANT_A)).toEqual(['a1', 'a2', 'a3']);
    expect(await adminLabels(TENANT_B)).toEqual(['b1']);
  });

  it('rejects an insert without a tenant', async () => {
    await expectRlsViolation(db.insert(roles).values({ tenantId: TENANT_A, name: 'x' }));
  });

  it('rejects an update that moves a row to another tenant and cannot touch foreign rows', async () => {
    await expectRlsViolation(withTenant(db, TENANT_A, (tx) => tx.update(roles).set({ tenantId: TENANT_B }).where(eq(roles.name, 'a1'))));
    const touched = await withTenant(db, TENANT_A, (tx) =>
      tx.update(roles).set({ name: 'hacked' }).where(eq(roles.name, 'b1')).returning(),
    );
    expect(touched).toEqual([]);
    expect(await adminLabels(TENANT_B)).toEqual(['b1']);
  });

  it('deletes nothing of another tenant', async () => {
    const deleted = await withTenant(db, TENANT_A, (tx) => tx.delete(roles).where(eq(roles.name, 'b1')).returning());
    expect(deleted).toEqual([]);
    expect(await adminLabels(TENANT_B)).toEqual(['b1']);
    const own = await withTenant(db, TENANT_A, (tx) => tx.delete(roles).returning());
    expect(labels(own)).toEqual(['a1', 'a2']);
  });

  it('does not leave a tenant active on the reused pooled connection', async () => {
    await withTenant(db, TENANT_A, (tx) => tx.select().from(roles));
    // max: 1 guarantees this runs on the very connection withTenant used.
    expect(await db.select().from(roles)).toEqual([]);
    const { rows } = await appPool.query("select current_setting('app.tenant_id', true) as tenant");
    expect(rows[0].tenant ?? '').toBe('');
  });

  it('rolls back everything when fn throws, and the pool stays usable', async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await tx.insert(roles).values({ tenantId: TENANT_A, name: 'ghost' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await adminLabels(TENANT_A)).toEqual(['a1', 'a2']);
    expect(labels(await withTenant(db, TENANT_A, (tx) => tx.select().from(roles)))).toEqual(['a1', 'a2']);
  });

  it('keeps concurrent tenants isolated on a multi-connection pool', async () => {
    const { pool, db: multi } = appDatabase(4);
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          withTenant(multi, i % 2 ? TENANT_A : TENANT_B, async (tx) => labels(await tx.select().from(roles))),
        ),
      );
      results.forEach((result, i) => expect(result).toEqual(i % 2 ? ['a1', 'a2'] : ['b1']));
    } finally {
      await pool.end();
    }
  });
});

describe('RLS on tenants (policy keyed on id), connected as monaco_app', () => {
  const names = (rows: { name: string }[]) => rows.map((row) => row.name).sort();

  it('shows only the current tenant row, and nothing without withTenant', async () => {
    expect(names(await withTenant(db, TENANT_A, (tx) => tx.select().from(tenants)))).toEqual(['Tenant A']);
    expect(names(await withTenant(db, TENANT_B, (tx) => tx.select().from(tenants)))).toEqual(['Tenant B']);
    expect(await db.select().from(tenants)).toEqual([]);
  });

  it('can lock and rename its own tenant but cannot touch another one', async () => {
    const locked = await withTenant(db, TENANT_A, (tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, TENANT_A)).for('update'));
    expect(locked).toEqual([{ id: TENANT_A }]);
    const foreign = await withTenant(db, TENANT_A, (tx) => tx.update(tenants).set({ name: 'hacked' }).where(eq(tenants.id, TENANT_B)).returning());
    expect(foreign).toEqual([]);
    await withTenant(db, TENANT_A, (tx) => tx.update(tenants).set({ name: 'Renamed A' }).where(eq(tenants.id, TENANT_A)));
    const { rows } = await admin.query('select id, name from tenants order by slug');
    expect(rows).toEqual([
      { id: TENANT_A, name: 'Renamed A' },
      { id: TENANT_B, name: 'Tenant B' },
    ]);
  });

  it('cannot create or delete tenants (the CLI does, as owner)', async () => {
    const insert = await rejection(withTenant(db, TENANT_A, (tx) => tx.insert(tenants).values({ id: TENANT_A, name: 'x', slug: 'x' })));
    expect(insert.message).toMatch(/permission denied for table tenants/);
    const remove = await rejection(withTenant(db, TENANT_A, (tx) => tx.delete(tenants).where(eq(tenants.id, TENANT_A))));
    expect(remove.message).toMatch(/permission denied for table tenants/);
  });
});
