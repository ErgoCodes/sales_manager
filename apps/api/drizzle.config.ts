import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// Local convenience, as in main.ts; CI and containers inject the environment.
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');

/**
 * Migrations run as the schema owner (monaco_owner), never as the runtime role
 * the API uses (DATABASE_URL = monaco_app). `db:generate` needs no database,
 * so the URL is only required by `db:migrate` and `db:studio`.
 */
const url = process.env.DATABASE_MIGRATION_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  ...(url ? { dbCredentials: { url } } : {}),
});
