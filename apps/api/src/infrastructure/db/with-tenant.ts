import { sql } from 'drizzle-orm';

import type { Database } from './database';
import { TENANT_SETTING } from './schema/tenancy';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

declare const tenantScoped: unique symbol;

/**
 * A transaction that `withTenant` opened and scoped to a tenant. The brand
 * uses a symbol that is never exported, so outside this file the only way to
 * get one is `withTenant` itself (or an explicit, reviewable cast). Tenant
 * repositories take this type, not `Transaction`, so they cannot run on the
 * root database or on an unscoped transaction (ADR 0004).
 */
export type TenantTransaction = Transaction & { readonly [tenantScoped]: true };

// Any 8-4-4-4-12 hex UUID (Postgres accepts every version and variant).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTenantIdError extends Error {
  constructor() {
    super('Tenant id must be a UUID');
    this.name = 'InvalidTenantIdError';
  }
}

/**
 * Runs `fn` inside a transaction scoped to `tenantId` (ADR 0003). The tenant
 * travels as a bind parameter to `set_config(..., true)`, which is local to
 * the transaction: it disappears on commit/rollback, so it can never leak to
 * another request that reuses the pooled connection. Every tenant-scoped query
 * must use the `tx` it receives, not the root database.
 */
export async function withTenant<T>(db: Database, tenantId: string, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new InvalidTenantIdError();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_SETTING}, ${tenantId}, true)`);
    return fn(tx as TenantTransaction);
  });
}
