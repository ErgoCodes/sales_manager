import { type DynamicModule, Inject, type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter, EXCEPTION_MAPPERS } from './common/http/all-exceptions.filter';
import { bodyParsers } from './common/http/body-parsers';
import { clientIpMiddleware } from './common/http/client-ip';
import { buildLoggerParams } from './common/logging/logger.config';
import { AppConfigModule } from './config/app-config.module';
import { APP_CONFIG } from './config/app-config.token';
import type { AppConfig } from './config/env';
import { DatabaseModule } from './infrastructure/db/database.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { toCatalogDomainError } from './modules/catalog/http/catalog-http-errors';
import { DevicesModule } from './modules/devices/devices.module';
import { HealthModule } from './modules/health/health.module';
import { toMappedDomainError } from './modules/iam/http/auth-http-errors';
import { IamModule } from './modules/iam/iam.module';
import { toInventoryMappedError } from './modules/inventory/http/inventory-http-errors';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LocationsModule } from './modules/locations/locations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { SalesModule } from './modules/sales/sales.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Root module. It receives an already-validated config instead of reading
 * `process.env`, so `main.ts`, the OpenAPI generator and tests each decide
 * where the config comes from.
 *
 * Not global on purpose: Nest registers global modules' middleware first, and
 * the logger (global) must run before the body parsers configured here.
 */
@Module({})
export class AppModule implements NestModule {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggerModule.forRoot(buildLoggerParams(config)),
        DatabaseModule,
        HealthModule,
        IamModule,
        LocationsModule,
        CatalogModule,
        InventoryModule,
        SalesModule,
        ReportsModule,
        RolesModule,
        UsersModule,
        AssignmentsModule,
        DevicesModule,
        AuditModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        {
          provide: EXCEPTION_MAPPERS,
          useValue: [toMappedDomainError, toCatalogDomainError, toInventoryMappedError],
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // The client IP is resolved before any guard (AuthGuard, throttler) runs.
    consumer
      .apply(...bodyParsers(), clientIpMiddleware(this.config.CLIENT_IP_HMAC_SECRET, { trustedProxyHops: this.config.TRUSTED_PROXY_HOPS }))
      .forRoutes({ path: '{/*splat}', method: RequestMethod.ALL });
  }
}
