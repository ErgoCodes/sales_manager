import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { EXIT_REASONS, INVENTORY_DOCUMENT_KINDS, PERMISSIONS } from '@monaco/contracts';
import { CATEGORIES, INVENTORY_MOVEMENT_KINDS, movementDelta, UNITS_OF_MEASURE } from '@monaco/domain';
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

  it('the latest migration snapshot has the permission CHECK of the current catalog (no pending db:generate)', () => {
    // Without a database: if PERMISSIONS changes and nobody runs `pnpm --filter api db:generate`,
    // the committed snapshot still lists the old catalog. The integration suite checks the real constraint.
    const journal = JSON.parse(readFileSync(join(apiRoot, 'drizzle/meta/_journal.json'), 'utf8')) as { entries: { idx: number }[] };
    const last = String(journal.entries.at(-1)!.idx).padStart(4, '0');
    const snapshot = JSON.parse(readFileSync(join(apiRoot, `drizzle/meta/${last}_snapshot.json`), 'utf8'));
    const check: string = snapshot.tables['public.role_permissions'].checkConstraints.role_permissions_permission_check.value;
    const values = [...check.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(values.sort()).toEqual([...PERMISSIONS].sort());
  });

  it('the latest migration snapshot has the catalog and inventory CHECKs of the current shared catalogs (no pending db:generate)', () => {
    const journal = JSON.parse(readFileSync(join(apiRoot, 'drizzle/meta/_journal.json'), 'utf8')) as { entries: { idx: number }[] };
    const last = String(journal.entries.at(-1)!.idx).padStart(4, '0');
    const { tables } = JSON.parse(readFileSync(join(apiRoot, `drizzle/meta/${last}_snapshot.json`), 'utf8'));
    const listed = (table: string, name: string): string[] =>
      [...(tables[`public.${table}`].checkConstraints[name].value as string).matchAll(/'([^']+)'/g)].map((match) => match[1]!).sort();
    const sorted = (values: readonly string[]) => [...values].sort();
    expect(listed('products', 'products_unit_of_measure_check')).toEqual(sorted(UNITS_OF_MEASURE.map((unit) => unit.value)));
    expect(listed('products', 'products_category_check')).toEqual(sorted(CATEGORIES));
    expect(listed('inventory_movements', 'inventory_movements_kind_check')).toEqual(sorted(INVENTORY_MOVEMENT_KINDS));
    expect(listed('inventory_documents', 'inventory_documents_kind_check')).toEqual(sorted(INVENTORY_DOCUMENT_KINDS));
    expect(listed('inventory_documents', 'inventory_documents_reason_check')).toEqual(sorted(EXIT_REASONS));
    // Every kind with a fixed sign in the domain has its sign in the CHECK (defence in depth).
    const sign: string = tables['public.inventory_movements'].checkConstraints.inventory_movements_sign_check.value;
    for (const kind of INVENTORY_MOVEMENT_KINDS) {
      if (kind === 'adjustment' || kind === 'reversal') continue;
      const expected = movementDelta(kind, 1) > 0 ? '> 0' : '< 0';
      expect(sign, kind).toMatch(new RegExp(`when '${kind}' then "inventory_movements"\\."quantity_delta" ${expected}`));
    }
  });
});
