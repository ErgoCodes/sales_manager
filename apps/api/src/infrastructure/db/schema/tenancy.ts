import { sql } from 'drizzle-orm';
import { pgPolicy } from 'drizzle-orm/pg-core';

/**
 * Transaction-local setting that carries the current tenant (see `withTenant`).
 * `current_setting(..., true)` returns NULL when it was never set and '' once a
 * previous transaction on the same pooled connection set it locally, so both
 * cases go through NULLIF and compare as NULL: no setting means no rows,
 * instead of an error.
 */
export const TENANT_SETTING = 'app.tenant_id';

const currentTenant = sql.raw(`nullif(current_setting('${TENANT_SETTING}', true), '')::uuid`);

/**
 * Tenancy convention (ADR 0003): every tenant-owned table has
 * `tenant_id uuid not null` and this policy. It applies to every role (PUBLIC),
 * filters reads (USING) and rejects writes for another tenant (WITH CHECK).
 * Drizzle enables RLS when a table has a policy; FORCE ROW LEVEL SECURITY is
 * added by a custom migration, since drizzle-kit does not model it.
 */
export function tenantIsolationPolicy(table: string) {
  return pgPolicy(`${table}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: sql`tenant_id = ${currentTenant}`,
    withCheck: sql`tenant_id = ${currentTenant}`,
  });
}
