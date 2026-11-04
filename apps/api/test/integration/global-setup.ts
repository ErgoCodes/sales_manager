import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';

import type { IntegrationUrls } from './urls';

declare module 'vitest' {
  export interface ProvidedContext {
    urls: IntegrationUrls;
  }
}

const apiRoot = resolve(__dirname, '../..');
const initSql = resolve(apiRoot, '../../infra/postgres/init.sql');

/**
 * Once per run: starts Postgres, applies infra/postgres/init.sql (roles and
 * privileges, ADR 0003) as the bootstrap superuser through the image's
 * initdb hook, then runs the real drizzle migrations as monaco_owner.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const image = process.env.POSTGRES_IMAGE ?? 'postgres:17-alpine';
  const container = await new PostgreSqlContainer(image)
    .withDatabase('monaco_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withCopyFilesToContainer([{ source: initSql, target: '/docker-entrypoint-initdb.d/01-roles.sql' }])
    .start();

  const as = (user: string) => {
    const url = new URL(container.getConnectionUri());
    url.username = user;
    url.password = user;
    return url.toString();
  };

  const owner = as('monaco_owner');
  const pool = new Pool({ connectionString: owner, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: resolve(apiRoot, 'drizzle') });
  } finally {
    await pool.end();
  }

  project.provide('urls', { admin: container.getConnectionUri(), owner, app: as('monaco_app') });
  return async () => {
    await container.stop();
  };
}
