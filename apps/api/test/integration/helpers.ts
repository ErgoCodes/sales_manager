import { Pool } from 'pg';
import { inject } from 'vitest';

import { createDatabase, createPool } from '../../src/infrastructure/db/database';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';

export function urls() {
  return inject('urls');
}

/** Superuser pool, for seeding and inspecting rows regardless of RLS. */
export function adminPool(): Pool {
  return new Pool({ connectionString: urls().admin, max: 2 });
}

/** The API's own pool (monaco_app); max 1 so every call reuses the connection. */
export function appDatabase(max = 1) {
  const pool = createPool(urls().app, { max });
  return { pool, db: createDatabase(pool) };
}

/** Empties the probe table as superuser (TRUNCATE is not granted to the app). */
export async function resetProbe(admin: Pool): Promise<void> {
  await admin.query('truncate table _tenancy_probe');
}

/** One row per tenant, inserted as superuser. */
export async function seedProbe(admin: Pool): Promise<void> {
  await admin.query(
    `insert into _tenancy_probe (tenant_id, label) values ($1, 'a1'), ($1, 'a2'), ($2, 'b1')`,
    [TENANT_A, TENANT_B],
  );
}

/**
 * Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the
 * `cause`. Asserts it is an RLS violation (SQLSTATE 42501).
 */
export async function expectRlsViolation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!error) throw new Error('Expected a row-level security violation, but the statement succeeded');
  const cause = (error as { cause?: { code?: string; message?: string } }).cause ?? (error as { code?: string; message?: string });
  if (cause.code !== '42501' || !/row-level security/i.test(cause.message ?? '')) throw error;
}
