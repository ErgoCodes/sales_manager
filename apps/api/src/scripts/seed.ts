import { Argon2PasswordHasher } from '../modules/iam/infrastructure/argon2-password-hasher';
import { DEMO_SLUG, DEMO_USERS, seedDemoWithOwnerConnection } from './demo-seed';

/** `db:seed`: development data only. Never runs with NODE_ENV=production. */
export async function runSeed(env: Readonly<Record<string, string | undefined>>, out: (line: string) => void): Promise<void> {
  if (env.NODE_ENV === 'production') throw new Error('db:seed creates development credentials and refuses to run with NODE_ENV=production');
  await seedDemoWithOwnerConnection(env, new Argon2PasswordHasher());
  out(`Demo tenant "${DEMO_SLUG}" is ready (2 locations). Development logins, passwords in the README:`);
  for (const user of Object.values(DEMO_USERS)) out(`  ${user.email}`);
}
