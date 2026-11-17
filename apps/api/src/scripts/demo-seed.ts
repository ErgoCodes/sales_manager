import { and, eq } from 'drizzle-orm';

import { locations, tenants, users } from '../infrastructure/db/schema';
import { uuidv7 } from '../infrastructure/db/uuidv7';
import { withTenant } from '../infrastructure/db/with-tenant';
import type { PasswordHasher } from '../modules/iam/domain/auth-ports';
import { assignRole, ensureSystemRoles, insertUser, pgError, withOwnerDatabase } from './provisioning';
import type { Database } from '../infrastructure/db/database';
import type { TenantTransaction } from '../infrastructure/db/with-tenant';

/** Fixed so re-running the seed finds the same tenant (a tenant is invisible to RLS outside its own context). */
export const DEMO_TENANT_ID = '01990000-0000-7000-8000-000000000001';
export const DEMO_SLUG = 'demo';

/** Development-only credentials, documented in the README. The seed refuses to run in production. */
export const DEMO_USERS = {
  owner: { email: 'owner@demo.example', displayName: 'Demo Owner', password: 'demo-owner-pass' },
  manager: { email: 'manager@demo.example', displayName: 'Demo Manager', password: 'demo-manager-pass' },
  cashier: { email: 'cashier@demo.example', displayName: 'Demo Cashier', password: 'demo-cashier-pass' },
} as const;

const DEMO_LOCATIONS = [
  { code: 'P1', name: 'Punto 1' },
  { code: 'P2', name: 'Punto 2' },
] as const;

async function createDemoUser(tx: TenantTransaction, key: keyof typeof DEMO_USERS, hasher: PasswordHasher): Promise<string> {
  const demo = DEMO_USERS[key];
  const passwordHash = await hasher.hash(demo.password);
  try {
    return await insertUser(tx, DEMO_TENANT_ID, {
      email: demo.email,
      displayName: demo.displayName,
      passwordHash,
      mustChangePassword: false,
      passwordExpiresAt: null,
    });
  } catch (error) {
    // Emails are unique across tenants; RLS hides the other tenant's row from the lookup above.
    const { code, constraint } = pgError(error);
    if (code === '23505' && constraint === 'users_email_unique') throw new Error(`The email ${demo.email} already belongs to another tenant`);
    throw error;
  }
}

/** Idempotent: existing rows (and passwords changed since) are left untouched. */
export async function seedDemo(db: Database, hasher: PasswordHasher): Promise<void> {
  await withTenant(db, DEMO_TENANT_ID, async (tx) => {
    await tx.insert(tenants).values({ id: DEMO_TENANT_ID, name: 'Demo', slug: DEMO_SLUG }).onConflictDoNothing({ target: tenants.id });
    const roleIds = await ensureSystemRoles(tx, DEMO_TENANT_ID);

    const locationIds: string[] = [];
    for (const { code, name } of DEMO_LOCATIONS) {
      await tx
        .insert(locations)
        .values({ id: uuidv7(), tenantId: DEMO_TENANT_ID, code, name })
        .onConflictDoNothing({ target: [locations.tenantId, locations.code] });
      const [location] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.tenantId, DEMO_TENANT_ID), eq(locations.code, code)));
      locationIds.push(location!.id);
    }

    for (const key of ['owner', 'manager', 'cashier'] as const) {
      const demo = DEMO_USERS[key];
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, demo.email));
      const userId = existing?.id ?? (await createDemoUser(tx, key, hasher));
      await assignRole(tx, DEMO_TENANT_ID, userId, roleIds[key], key === 'owner' ? undefined : [locationIds[0]!]);
    }
  });
}

export async function seedDemoWithOwnerConnection(env: Readonly<Record<string, string | undefined>>, hasher: PasswordHasher): Promise<void> {
  try {
    await withOwnerDatabase(env, (db) => seedDemo(db, hasher));
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code === '23505' && constraint === 'tenants_slug_unique') {
      throw new Error(`The slug "${DEMO_SLUG}" already belongs to another tenant; rename or remove it before seeding the demo`);
    }
    throw error;
  }
}
