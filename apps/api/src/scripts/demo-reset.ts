import { sql } from 'drizzle-orm';

import type { Database } from '../infrastructure/db/database';
import type { Clock, PasswordHasher } from '../modules/iam/domain/auth-ports';
import { Argon2PasswordHasher } from '../modules/iam/infrastructure/argon2-password-hasher';
import { systemClock } from '../modules/iam/infrastructure/system-clock';
import { DEMO_SLUG, seedDemo } from './demo-seed';
import { inOneTransaction, withOwnerDatabase } from './provisioning';

/** History of the public demo (spec, "Seed demo"): 90 days, today included. */
export const DEMO_RESET_HISTORY_DAYS = 90;

export interface DemoResetDependencies {
  readonly hasher?: PasswordHasher;
  readonly clock?: Clock;
  readonly historyDays?: number;
}

/**
 * Slugs of the tenants with `read_only = false`. `tenants` has FORCE ROW LEVEL SECURITY, which
 * binds even its owner, and no tenant context can see every row; so, inside the reset's own
 * transaction, the owner lifts FORCE on that one table, reads, and puts it back. Being DDL in the
 * same transaction, FORCE is back on before anyone else can see the table (ACCESS EXCLUSIVE lock),
 * and a rollback restores it too.
 */
async function writableTenants(tx: Database): Promise<string[]> {
  await tx.execute(sql`alter table tenants no force row level security`);
  const { rows } = await tx.execute<{ slug: string }>(sql`select slug from tenants where not read_only order by slug`);
  await tx.execute(sql`alter table tenants force row level security`);
  return rows.map((row) => row.slug);
}

/** Every table with a `tenant_id`, plus `tenants`: listed from the catalog, so a new tenant table is never left behind. */
async function truncateTenantTables(tx: Database): Promise<string[]> {
  const { rows } = await tx.execute<{ table_name: string }>(
    sql`select distinct c.table_name from information_schema.columns c
          join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
         order by c.table_name`,
  );
  const tables = [...rows.map((row) => row.table_name), 'tenants'];
  const list = tables.map((name) => `"public"."${name.replaceAll('"', '""')}"`).join(', ');
  // TRUNCATE is not subject to RLS (ADR 0003): only the owner can run it. No CASCADE: a table
  // outside this list that references them makes the reset fail instead of being emptied.
  await tx.execute(sql.raw(`truncate table ${list}`));
  return tables;
}

/**
 * `demo:reset`: regenerates the public demo (D10, ADR 0008). Runs as `monaco_owner`
 * (DATABASE_MIGRATION_URL). Refuses unless DEMO_RESET_CONFIRM is the demo slug and every tenant
 * in the database is read-only (the demo database holds only the demo tenant; a real or a
 * `db:seed` tenant is never wiped). In ONE transaction: TRUNCATE of every tenant table (sessions
 * and refresh tokens included, so visitors are signed out), the demo tenant again with
 * `read_only = true`, and 90 days of history through the use cases. Requests that arrive
 * meanwhile wait on the TRUNCATE locks and then see the new data: never a half-reset state.
 */
export async function runDemoReset(
  env: Readonly<Record<string, string | undefined>>,
  out: (line: string) => void,
  deps: DemoResetDependencies = {},
): Promise<void> {
  if (env.DEMO_RESET_CONFIRM !== DEMO_SLUG) {
    throw new Error(`demo:reset empties every tenant table: set DEMO_RESET_CONFIRM=${DEMO_SLUG} to confirm`);
  }
  const historyDays = deps.historyDays ?? DEMO_RESET_HISTORY_DAYS;
  const started = Date.now();
  const result = await withOwnerDatabase(env, (db) =>
    inOneTransaction(db, async (tx) => {
      // Fail instead of queueing forever behind a long-running request.
      await tx.execute(sql`set local lock_timeout = '30s'`);
      const writable = await writableTenants(tx);
      if (writable.length > 0) {
        throw new Error(`demo:reset refuses to run: tenant(s) ${writable.join(', ')} are not read-only (the demo database holds only the read-only demo tenant)`);
      }
      const tables = await truncateTenantTables(tx);
      const seeded = await seedDemo(tx, deps.hasher ?? new Argon2PasswordHasher(), { historyDays, readOnly: true }, deps.clock ?? systemClock);
      return { tables: tables.length, documents: seeded.documents };
    }),
  );
  out(`Demo tenant "${DEMO_SLUG}" reset (read-only): ${result.tables} tables emptied, ${historyDays} days of history, ${result.documents} documents, ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}
