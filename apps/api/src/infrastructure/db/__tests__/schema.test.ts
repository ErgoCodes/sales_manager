import { is } from 'drizzle-orm';
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../schema';

// Tenancy convention (ADR 0003): a table with tenant_id must carry the
// isolation policy for every command, with both USING and WITH CHECK.
const tables: PgTable[] = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
const dialect = new PgDialect();

describe('schema tenancy convention', () => {
  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
    '%s has the tenant isolation policy',
    (_name, table) => {
      const config = getTableConfig(table);
      const tenantId = config.columns.find((column) => column.name === 'tenant_id');
      expect(tenantId?.notNull).toBe(true);
      expect(tenantId?.getSQLType()).toBe('uuid');

      const [policy] = config.policies;
      expect(config.policies).toHaveLength(1);
      expect(policy).toMatchObject({ as: 'permissive', for: 'all', to: 'public' });
      const expected = "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid";
      expect(dialect.sqlToQuery(policy!.using!).sql).toBe(expected);
      expect(dialect.sqlToQuery(policy!.withCheck!).sql).toBe(expected);
    },
  );

  it('includes the probe table', () => {
    expect(tables.map((table) => getTableConfig(table).name)).toContain('_tenancy_probe');
  });
});
