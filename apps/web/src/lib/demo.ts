import 'server-only';
import { z } from 'zod';

/** One public demo account shown on `/login` (SP4 · D10). Defined in server env, never `NEXT_PUBLIC_`. */
export interface DemoAccount {
  label: string;
  email: string;
  password: string;
}

const DemoAccounts = z.array(z.object({ label: z.string().trim().min(1).max(40), email: z.email(), password: z.string().min(1).max(200) })).max(5);

/**
 * Accounts of the public demo: only with `DEMO_MODE=true`, from `DEMO_ACCOUNTS` (JSON array of
 * `{ label, email, password }`). The credentials live in the deployment's env (they are the published
 * demo ones, valid only in the read-only tenant), never in the web code. Anything malformed shows none.
 */
export function demoAccounts(source: Record<string, string | undefined> = process.env): DemoAccount[] {
  if (source.DEMO_MODE !== 'true' || !source.DEMO_ACCOUNTS) return [];
  try {
    const parsed = DemoAccounts.safeParse(JSON.parse(source.DEMO_ACCOUNTS));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
