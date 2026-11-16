import { parseArgs } from 'node:util';

import { z } from 'zod';

import { withTenant } from '../infrastructure/db/with-tenant';
import { tenants } from '../infrastructure/db/schema';
import { uuidv7 } from '../infrastructure/db/uuidv7';
import { issueTemporaryPassword } from '../modules/users/application/users.use-cases';
import { RandomTemporaryPasswordGenerator } from '../modules/users/infrastructure/random-temporary-password';
import { Argon2PasswordHasher } from '../modules/iam/infrastructure/argon2-password-hasher';
import { systemClock } from '../modules/iam/infrastructure/system-clock';
import { assignRole, ensureSystemRoles, insertUser, pgError, withOwnerDatabase } from './provisioning';

const Args = z.object({
  name: z.string().trim().min(1, '--name is required').max(120),
  slug: z
    .string({ error: '--slug is required' })
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, digits and single hyphens')
    .max(60),
  'owner-email': z.email('--owner-email must be a valid email address'),
});

export const USAGE = 'Usage: pnpm --filter api tenant:create --name <name> --slug <slug> --owner-email <email>';

/**
 * `tenant:create`: creates a tenant, its system roles and its owner with a
 * temporary password (72 h, must change it). The password goes to `out` once
 * and is never logged anywhere else.
 */
export async function runTenantCreate(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: { name: { type: 'string' }, slug: { type: 'string' }, 'owner-email': { type: 'string' } },
    strict: true,
  });
  const parsed = Args.safeParse(values);
  if (!parsed.success) throw new Error(`${parsed.error.issues.map((issue) => issue.message).join('; ')}\n${USAGE}`);
  const { name, slug, 'owner-email': ownerEmail } = parsed.data;

  const hasher = new Argon2PasswordHasher();
  const issue = await issueTemporaryPassword(new RandomTemporaryPasswordGenerator(), hasher, systemClock);
  const tenantId = uuidv7();

  try {
    await withOwnerDatabase(env, (db) =>
      // `tenants` is keyed on its own id by RLS: the new id is the tenant context for the whole transaction.
      withTenant(db, tenantId, async (tx) => {
        await tx.insert(tenants).values({ id: tenantId, name, slug });
        const roleIds = await ensureSystemRoles(tx, tenantId);
        const ownerId = await insertUser(tx, tenantId, {
          email: ownerEmail,
          displayName: ownerEmail.split('@')[0]!,
          passwordHash: issue.passwordHash,
          mustChangePassword: true,
          passwordExpiresAt: issue.expiresAt,
        });
        await assignRole(tx, tenantId, ownerId, roleIds.owner);
      }),
    );
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code === '23505' && constraint === 'tenants_slug_unique') throw new Error(`A tenant with slug "${slug}" already exists`);
    if (code === '23505' && constraint === 'users_email_unique') throw new Error(`The email ${ownerEmail} is already registered`);
    throw error;
  }

  out(`Tenant created: ${name} (${slug}), id ${tenantId}`);
  out(`Owner: ${ownerEmail}`);
  out(`Temporary password: ${issue.temporaryPassword}`);
  out(`It is shown only once and expires at ${issue.expiresAt.toISOString()}; the owner must change it at first login.`);
}
