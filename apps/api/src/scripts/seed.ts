import { Argon2PasswordHasher } from '../modules/iam/infrastructure/argon2-password-hasher';
import { DEMO_SLUG, DEMO_USERS, seedDemoWithOwnerConnection } from './demo-seed';

/** NODE_ENV values under which the seed may run; unset counts as development. Anything else is refused. */
const SEED_ALLOWED_ENVS: readonly (string | undefined)[] = [undefined, 'development', 'test'];

/** `db:seed`: development data only. */
export async function runSeed(env: Readonly<Record<string, string | undefined>>, out: (line: string) => void): Promise<void> {
  if (!SEED_ALLOWED_ENVS.includes(env.NODE_ENV)) {
    throw new Error(
      `db:seed creates development credentials and only runs with NODE_ENV unset, "development" or "test" (got "${env.NODE_ENV}")`,
    );
  }
  await seedDemoWithOwnerConnection(env, new Argon2PasswordHasher());
  out(`Demo tenant "${DEMO_SLUG}" is ready (2 locations). Development logins, passwords in the README:`);
  for (const user of Object.values(DEMO_USERS)) out(`  ${user.email}`);
}
