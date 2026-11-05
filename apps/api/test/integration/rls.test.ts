import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { tenancyProbe } from '../../src/infrastructure/db/schema';
import { withTenant } from '../../src/infrastructure/db/with-tenant';
import { adminPool, expectRlsViolation, appDatabase, resetProbe, seedProbe, TENANT_A, TENANT_B } from './helpers';

const { pool: appPool, db } = appDatabase(1);
let admin: Pool;

const labels = (rows: { label: string }[]) => rows.map((row) => row.label).sort();
const adminLabels = async (tenant: string) =>
  labels((await admin.query<{ label: string }>('select label from _tenancy_probe where tenant_id = $1', [tenant])).rows);

beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await appPool.end();
  await admin.end();
});
beforeEach(async () => {
  await resetProbe(admin);
  await seedProbe(admin);
});

describe('RLS on _tenancy_probe, connected as monaco_app', () => {
  it('connects as the unprivileged runtime role', async () => {
    const { rows } = await appPool.query('select current_user, usesuper, usebypassrls from pg_user where usename = current_user');
    expect(rows[0]).toMatchObject({ current_user: 'monaco_app', usesuper: false, usebypassrls: false });
  });

  it('shows only the current tenant rows inside withTenant', async () => {
    expect(labels(await withTenant(db, TENANT_A, (tx) => tx.select().from(tenancyProbe)))).toEqual(['a1', 'a2']);
    expect(labels(await withTenant(db, TENANT_B, (tx) => tx.select().from(tenancyProbe)))).toEqual(['b1']);
  });

  it('shows nothing without withTenant', async () => {
    expect(await db.select().from(tenancyProbe)).toEqual([]);
    expect((await appPool.query('select 1 from _tenancy_probe')).rowCount).toBe(0);
  });

  it('rejects an insert for another tenant (WITH CHECK) and accepts one for its own', async () => {
    await expectRlsViolation(withTenant(db, TENANT_A, (tx) => tx.insert(tenancyProbe).values({ tenantId: TENANT_B, label: 'evil' })));
    await withTenant(db, TENANT_A, (tx) => tx.insert(tenancyProbe).values({ tenantId: TENANT_A, label: 'a3' }));
    expect(await adminLabels(TENANT_A)).toEqual(['a1', 'a2', 'a3']);
    expect(await adminLabels(TENANT_B)).toEqual(['b1']);
  });

  it('rejects an insert without a tenant', async () => {
    await expectRlsViolation(db.insert(tenancyProbe).values({ tenantId: TENANT_A, label: 'x' }));
  });

  it('rejects an update that moves a row to another tenant and cannot touch foreign rows', async () => {
    await expectRlsViolation(withTenant(db, TENANT_A, (tx) => tx.update(tenancyProbe).set({ tenantId: TENANT_B }).where(eq(tenancyProbe.label, 'a1'))));
    const touched = await withTenant(db, TENANT_A, (tx) =>
      tx.update(tenancyProbe).set({ label: 'hacked' }).where(eq(tenancyProbe.label, 'b1')).returning(),
    );
    expect(touched).toEqual([]);
    expect(await adminLabels(TENANT_B)).toEqual(['b1']);
  });

  it('deletes nothing of another tenant', async () => {
    const deleted = await withTenant(db, TENANT_A, (tx) => tx.delete(tenancyProbe).where(eq(tenancyProbe.label, 'b1')).returning());
    expect(deleted).toEqual([]);
    expect(await adminLabels(TENANT_B)).toEqual(['b1']);
    const own = await withTenant(db, TENANT_A, (tx) => tx.delete(tenancyProbe).returning());
    expect(labels(own)).toEqual(['a1', 'a2']);
  });

  it('does not leave a tenant active on the reused pooled connection', async () => {
    await withTenant(db, TENANT_A, (tx) => tx.select().from(tenancyProbe));
    // max: 1 guarantees this runs on the very connection withTenant used.
    expect(await db.select().from(tenancyProbe)).toEqual([]);
    const { rows } = await appPool.query("select current_setting('app.tenant_id', true) as tenant");
    expect(rows[0].tenant ?? '').toBe('');
  });

  it('rolls back everything when fn throws, and the pool stays usable', async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await tx.insert(tenancyProbe).values({ tenantId: TENANT_A, label: 'ghost' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await adminLabels(TENANT_A)).toEqual(['a1', 'a2']);
    expect(labels(await withTenant(db, TENANT_A, (tx) => tx.select().from(tenancyProbe)))).toEqual(['a1', 'a2']);
  });

  it('keeps concurrent tenants isolated on a multi-connection pool', async () => {
    const { pool, db: multi } = appDatabase(4);
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          withTenant(multi, i % 2 ? TENANT_A : TENANT_B, async (tx) => labels(await tx.select().from(tenancyProbe))),
        ),
      );
      results.forEach((result, i) => expect(result).toEqual(i % 2 ? ['a1', 'a2'] : ['b1']));
    } finally {
      await pool.end();
    }
  });
});
