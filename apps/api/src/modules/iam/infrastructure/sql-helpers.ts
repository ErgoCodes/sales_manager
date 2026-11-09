import { PERMISSIONS, type Permission } from '@monaco/contracts';
import type { SQL } from 'drizzle-orm';

import type { TenantTransaction } from '../../../infrastructure/db/with-tenant';

const CATALOG = new Set<string>(PERMISSIONS);

/** Filters raw database strings to validated permissions in the contracts catalog. */
export const filterCatalogPermissions = (permissions: readonly string[]): Permission[] =>
  permissions.filter((p): p is Permission => CATALOG.has(p));

/** Rows of a raw query run on a tenant-scoped transaction. */
export async function rows<T>(tx: TenantTransaction, query: SQL): Promise<T[]> {
  const result = await tx.execute(query);
  return result.rows as T[];
}

/** node-postgres binds a Buffer as bytea (a plain Uint8Array would be stringified). */
export const toBytea = (bytes: Uint8Array): Buffer => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Drizzle's node-postgres driver returns timestamptz as text on raw queries;
 * repositories convert at the edge so ports only ever see `Date`.
 */
export function toDate(value: Date | string): Date;
export function toDate(value: Date | string | null): Date | null;
export function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}
