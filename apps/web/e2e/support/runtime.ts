import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DemoUser {
  email: string;
  displayName: string;
  password: string;
}

export interface E2eRuntime {
  apiPort: string;
  webPort: string;
  apiUrl: string;
  webOrigin: string;
  databaseUrl: string;
  jwtPrivateJwk: string;
  clientIpHmacSecret: string;
  /** DEMO_USERS of apps/api/src/scripts/demo-seed.ts, copied by e2e/prepare.mjs (the only source of the demo credentials). */
  demoUsers: { owner: DemoUser; manager: DemoUser; cashier: DemoUser };
}

/** Written by `pnpm --filter web e2e:prepare`. */
export function loadRuntime(): E2eRuntime {
  const file = resolve(__dirname, '../.runtime/env.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as E2eRuntime;
  } catch {
    throw new Error(`Missing ${file}: run "pnpm --filter web e2e:prepare" first (or "pnpm --filter web test:e2e", which does it).`);
  }
}
