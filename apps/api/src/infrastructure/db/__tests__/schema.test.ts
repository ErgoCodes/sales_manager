import { is } from 'drizzle-orm';
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../schema';

// Tenancy convention (ADR 0003): a table with tenant_id must carry the
// isolation policy for every command, with both USING and WITH CHECK.
// `tenants` is the one explicit exception: no tenant_id, policy keyed on id.
const ROW_IS_TENANT = 'tenants';
// Not tenant-scoped on purpose: RLS enabled (and forced, migration 0006) with
// no policy at all, reachable only through a SECURITY DEFINER function (ADR 0004).
const NO_TENANT = ['rate_limits'];
const tables: PgTable[] = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
const tenantOwned = tables.filter((table) => ![ROW_IS_TENANT, ...NO_TENANT].includes(getTableConfig(table).name));
const dialect = new PgDialect();
const policySql = (column: string) => `${column} = nullif(current_setting('app.tenant_id', true), '')::uuid`;

function expectSinglePolicy(table: PgTable, expected: string) {
  const config = getTableConfig(table);
  const [policy] = config.policies;
  expect(config.policies).toHaveLength(1);
  expect(policy).toMatchObject({ as: 'permissive', for: 'all', to: 'public' });
  expect(dialect.sqlToQuery(policy!.using!).sql).toBe(expected);
  expect(dialect.sqlToQuery(policy!.withCheck!).sql).toBe(expected);
}

describe('schema tenancy convention', () => {
  it.each(tenantOwned.map((table) => [getTableConfig(table).name, table] as const))(
    '%s has tenant_id and the tenant isolation policy',
    (_name, table) => {
      const tenantId = getTableConfig(table).columns.find((column) => column.name === 'tenant_id');
      expect(tenantId?.notNull).toBe(true);
      expect(tenantId?.getSQLType()).toBe('uuid');
      expectSinglePolicy(table, policySql('tenant_id'));
    },
  );

  it('tenants has no tenant_id and its policy keys on id', () => {
    const tenants = tables.find((table) => getTableConfig(table).name === ROW_IS_TENANT)!;
    expect(getTableConfig(tenants).columns.map((column) => column.name)).not.toContain('tenant_id');
    expectSinglePolicy(tenants, policySql('id'));
  });

  it('rate_limits has RLS enabled, no tenant_id and no policy (deny by default)', () => {
    const config = getTableConfig(tables.find((table) => getTableConfig(table).name === 'rate_limits')!);
    expect(config.enableRLS).toBe(true);
    expect(config.policies).toEqual([]);
    expect(config.columns.map((column) => column.name)).not.toContain('tenant_id');
  });

  it('includes every SP2 table (the guards are not vacuous)', () => {
    expect(tables.map((table) => getTableConfig(table).name).sort()).toEqual([
      'audit_events',
      'devices',
      'locations',
      'rate_limits',
      'refresh_tokens',
      'role_assignment_locations',
      'role_assignments',
      'role_permissions',
      'roles',
      'tenants',
      'users',
    ]);
  });

  it.each(tenantOwned.map((table) => [getTableConfig(table).name, table] as const))(
    '%s references other tenant-owned rows only through composite (x_id, tenant_id) FKs',
    (_name, table) => {
      for (const fk of getTableConfig(table).foreignKeys) {
        const { columns, foreignTable, foreignColumns } = fk.reference();
        if (getTableConfig(foreignTable).name === ROW_IS_TENANT) {
          expect(columns.map((column) => column.name)).toEqual(['tenant_id']);
          continue;
        }
        expect(columns.map((column) => column.name)).toContain('tenant_id');
        const pairs = columns.map((column, i) => [column.name, foreignColumns[i]!.name]);
        expect(pairs).toContainEqual(['tenant_id', 'tenant_id']);
      }
    },
  );
});
