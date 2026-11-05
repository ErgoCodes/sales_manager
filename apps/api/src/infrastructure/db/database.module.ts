import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import { APP_CONFIG } from '../../config/app-config.token';
import type { AppConfig } from '../../config/env';
import { createDatabase, createPool } from './database';
import { DATABASE, PG_POOL } from './database.tokens';

/**
 * Owns the single pg pool of the API (connected as the runtime role,
 * `monaco_app`) and the Drizzle instance built on it. Global so any module's
 * infrastructure adapters can inject {@link DATABASE}.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const pool = createPool(config.DATABASE_URL);
        // Without a listener, an error on an idle client crashes the process.
        const logger = new Logger('Database');
        pool.on('error', (error) => logger.error(`Idle pg client error: ${error.message}`));
        return pool;
      },
    },
    { provide: DATABASE, inject: [PG_POOL], useFactory: createDatabase },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.pool.ended) await this.pool.end();
  }
}
