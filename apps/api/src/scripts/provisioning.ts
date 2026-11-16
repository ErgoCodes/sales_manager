import type { SystemRoleKey } from '@monaco/contracts';
import { and, eq } from 'drizzle-orm';

import { createDatabase, createPool, type Database } from '../infrastructure/db/database';
import { roleAssignmentLocations, roleAssignments, rolePermissions, roles, SYSTEM_ROLE_KEYS, users } from '../infrastructure/db/schema';
import { uuidv7 } from '../infrastructure/db/uuidv7';
import type { TenantTransaction } from '../infrastructure/db/with-tenant';
import { SYSTEM_ROLES } from '../modules/iam/domain/system-roles';
/** Postgres error behind a Drizzle "Failed query" wrapper, or the error itself. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  return ((error as { cause?: object }).cause ?? error) as { code?: string; constraint?: string };
}

/**
 * Runs `fn` with a database connected as the schema owner (DATABASE_MIGRATION_URL,
 * the same role as the migrations). The owner is still bound by FORCE RLS, so
 * callers work inside `withTenant`. Never uses the runtime DATABASE_URL.
 */
export async function withOwnerDatabase<T>(env: Readonly<Record<string, string | undefined>>, fn: (db: Database) => Promise<T>): Promise<T> {
  const url = env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL is required (the schema owner connection, as for db:migrate)');
  const pool = createPool(url, { max: 1 });
  try {
    return await fn(createDatabase(pool));
  } finally {
    await pool.end();
  }
}

/** Loads apps/api/.env for local runs, as main.ts and drizzle.config.ts do. */
export function loadLocalEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    try {
      process.loadEnvFile('.env');
    } catch {
      // No .env: the environment is injected (CI, containers).
    }
  }
}

/** Creates the owner/manager/cashier roles with their permissions; returns the role ids by key. Idempotent. */
export async function ensureSystemRoles(tx: TenantTransaction, tenantId: string): Promise<Record<SystemRoleKey, string>> {
  const ids = {} as Record<SystemRoleKey, string>;
  for (const key of SYSTEM_ROLE_KEYS) {
    const spec = SYSTEM_ROLES[key];
    await tx
      .insert(roles)
      .values({ id: uuidv7(), tenantId, key, name: spec.name, isSystem: true })
      .onConflictDoNothing({ target: [roles.tenantId, roles.key] });
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)));
    ids[key] = role!.id;
    await tx
      .insert(rolePermissions)
      .values(spec.permissions.map((permission) => ({ roleId: ids[key], permission, tenantId })))
      .onConflictDoNothing();
  }
  return ids;
}

export interface NewUser {
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly passwordExpiresAt: Date | null;
}

export async function insertUser(tx: TenantTransaction, tenantId: string, user: NewUser): Promise<string> {
  const id = uuidv7();
  await tx.insert(users).values({ id, tenantId, ...user });
  return id;
}

/** Assigns a role to a user (idempotent) and, for location scope, links its locations; returns the assignment id. */
export async function assignRole(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
  roleId: string,
  locationIds?: readonly string[],
): Promise<string> {
  await tx
    .insert(roleAssignments)
    .values({ id: uuidv7(), tenantId, userId, roleId, scope: locationIds ? 'locations' : 'tenant' })
    .onConflictDoNothing({ target: [roleAssignments.userId, roleAssignments.roleId] });
  const [assignment] = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.roleId, roleId)));
  const id = assignment!.id;
  if (locationIds?.length) {
    await tx
      .insert(roleAssignmentLocations)
      .values(locationIds.map((locationId) => ({ assignmentId: id, locationId, tenantId })))
      .onConflictDoNothing();
  }
  return id;
}
