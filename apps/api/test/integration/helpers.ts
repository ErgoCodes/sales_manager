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

/**
 * Resets the tenants and their data as superuser (TRUNCATE is not granted to
 * the app, and FORCE RLS binds even monaco_owner, so seeding uses postgres).
 */
export async function resetTenants(admin: Pool): Promise<void> {
  await admin.query('truncate table tenants cascade');
}

/** Tenants A and B; roles a1, a2 for A and b1 for B. Ids are passed explicitly (no DB default). */
export async function seedTenants(admin: Pool): Promise<void> {
  await admin.query(`insert into tenants (id, name, slug) values ($1, 'Tenant A', 'tenant-a'), ($2, 'Tenant B', 'tenant-b')`, [
    TENANT_A,
    TENANT_B,
  ]);
  await admin.query(
    `insert into roles (id, tenant_id, name) values
       (gen_random_uuid(), $1, 'a1'), (gen_random_uuid(), $1, 'a2'), (gen_random_uuid(), $2, 'b1')`,
    [TENANT_A, TENANT_B],
  );
}

/** Postgres error behind a Drizzle "Failed query" wrapper, or the error itself. */
export function pgError(error: unknown): { code?: string; message?: string; constraint?: string } {
  return (error as { cause?: object }).cause ?? (error as object);
}

/** Resolves to the Postgres error the promise rejects with; fails if it resolves. */
export async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!error) throw new Error('Expected the statement to fail, but it succeeded');
  return pgError(error);
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
  const cause = pgError(error);
  if (cause.code !== '42501' || !/row-level security/i.test(cause.message ?? '')) throw error;
}
