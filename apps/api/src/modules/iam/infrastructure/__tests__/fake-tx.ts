import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { vi } from 'vitest';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';

const dialect = new PgDialect();

/**
 * A tenant transaction that records every statement (SQL text + bound params)
 * and answers with `results` in order. The SQL itself runs against Postgres in
 * test/integration; unit tests check mapping and that inputs are parameters.
 */
export function fakeTx(...results: unknown[][]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    return { rows: results.shift() ?? [] };
  });
  return { tx: { execute } as unknown as TenantTransaction, queries };
}

export const TENANT = '0190a000-0000-7000-8000-000000000001';
export const ID = '0190a000-0000-7000-8000-000000000002';
export const NOW = new Date('2026-11-05T12:00:00.000Z');
export const NOW_TEXT = '2026-11-05 12:00:00+00';
