import { parseArgs } from 'node:util';

import { Argon2PasswordHasher } from '../modules/iam/infrastructure/argon2-password-hasher';
import { DEFAULT_HISTORY_DAYS, DEMO_SLUG, DEMO_USERS, seedDemoWithOwnerConnection } from './demo-seed';

/** NODE_ENV values under which the seed may run; unset counts as development. Anything else is refused. */
const SEED_ALLOWED_ENVS: readonly (string | undefined)[] = [undefined, 'development', 'test'];
/** Upper bound of `--history-days` (`demo:reset` uses 90). */
export const MAX_HISTORY_DAYS = 366;

export const SEED_USAGE = `Usage: pnpm --filter api db:seed [--history-days <1..${MAX_HISTORY_DAYS}, default ${DEFAULT_HISTORY_DAYS}>]`;

/** Parses `--history-days`: a whole number of days, today included. */
export function parseHistoryDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const days = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > MAX_HISTORY_DAYS) {
    throw new Error(`--history-days must be a whole number between 1 and ${MAX_HISTORY_DAYS} (got "${raw}")`);
  }
  return days;
}

/** `db:seed`: development data only. */
export async function runSeed(env: Readonly<Record<string, string | undefined>>, out: (line: string) => void, argv: readonly string[] = []): Promise<void> {
  if (!SEED_ALLOWED_ENVS.includes(env.NODE_ENV)) {
    throw new Error(
      `db:seed creates development credentials and only runs with NODE_ENV unset, "development" or "test" (got "${env.NODE_ENV}")`,
    );
  }
  const { values } = parseArgs({ args: [...argv], options: { 'history-days': { type: 'string' } }, strict: true });
  const historyDays = parseHistoryDays(values['history-days'], DEFAULT_HISTORY_DAYS);
  const result = await seedDemoWithOwnerConnection(env, new Argon2PasswordHasher(), { historyDays });
  out(`Demo tenant "${DEMO_SLUG}" is ready (2 locations). Development logins, passwords in the README:`);
  for (const user of Object.values(DEMO_USERS)) out(`  ${user.email}`);
  out(
    result.historySeeded
      ? `Seeded ${historyDays} days of history (${result.documents} documents).`
      : 'The demo tenant already has sales: history left as it was (demo:reset regenerates it).',
  );
}
