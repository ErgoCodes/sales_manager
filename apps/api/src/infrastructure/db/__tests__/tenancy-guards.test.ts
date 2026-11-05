import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../schema';

// Cheap guards for ADR 0003 that need no database.
const apiRoot = resolve(__dirname, '../../../..');
const srcRoot = join(apiRoot, 'src');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('tenancy guards', () => {
  const migrations = filesUnder(join(apiRoot, 'drizzle'))
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const tenantTables = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map(getTableConfig)
    .filter((config) => config.policies.length > 0)
    .map((config) => config.name);

  it.each(tenantTables)('migrations force row level security on %s', (table) => {
    // drizzle-kit does not generate FORCE; it must be in a custom migration.
    expect(migrations).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  });

  it('only with-tenant.ts sets app.* settings (never session-scoped)', () => {
    // A session-level SET/set_config(..., false) survives on pooled
    // connections and would leak a tenant to the next request.
    const allowed = new Set(['infrastructure/db/with-tenant.ts']);
    const forbidden = /set_config\s*\(|\bset\s+(session\s+|local\s+)?app\./i;
    const offenders = filesUnder(srcRoot)
      .filter((file) => file.endsWith('.ts') && !file.includes('/__tests__/'))
      .filter((file) => !allowed.has(relative(srcRoot, file)))
      .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });
});
