import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export type PoolOptions = Pick<PoolConfig, 'max' | 'connectionTimeoutMillis' | 'idleTimeoutMillis'>;

const DEFAULT_POOL_OPTIONS: Required<PoolOptions> = {
  max: 10,
  // Fail fast instead of queueing forever when Postgres is unreachable.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
};

/**
 * Creates the pg pool. It is lazy: no connection is opened until the first
 * query, so building the Nest app (OpenAPI generator, unit tests) never
 * touches the database.
 */
export function createPool(connectionString: string, options: PoolOptions = {}): Pool {
  return new Pool({ connectionString, ...DEFAULT_POOL_OPTIONS, ...options, application_name: 'monaco-api' });
}

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}
