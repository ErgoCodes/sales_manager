import { Module } from '@nestjs/common';

import type { AppConfig } from '../../config/env';
import { APP_CONFIG } from '../../config/app-config.token';
import { CheckHealth } from './application/check-health.use-case';
import type { DatabaseHealthPort } from './domain/database-health.port';
import { DATABASE_HEALTH_PORT } from './health.tokens';
import { HealthController } from './http/health.controller';
import { StubDatabaseHealthAdapter } from './infrastructure/stub-database-health.adapter';

/**
 * Composition root of the module: binds ports to adapters and builds use cases.
 * Swapping the stub for the Drizzle adapter (T4) only touches this file.
 */
@Module({
  controllers: [HealthController],
  providers: [
    { provide: DATABASE_HEALTH_PORT, useClass: StubDatabaseHealthAdapter },
    {
      provide: CheckHealth,
      inject: [DATABASE_HEALTH_PORT, APP_CONFIG],
      useFactory: (database: DatabaseHealthPort, config: AppConfig) =>
        new CheckHealth(database, config.APP_VERSION),
    },
  ],
})
export class HealthModule {}
