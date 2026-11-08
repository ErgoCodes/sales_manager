import { type DynamicModule, Inject, type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { bodyParsers } from './common/http/body-parsers';
import { clientIpMiddleware } from './common/http/client-ip';
import { buildLoggerParams } from './common/logging/logger.config';
import { AppConfigModule } from './config/app-config.module';
import { APP_CONFIG } from './config/app-config.token';
import type { AppConfig } from './config/env';
import { DatabaseModule } from './infrastructure/db/database.module';
import { HealthModule } from './modules/health/health.module';
import { IamModule } from './modules/iam/iam.module';

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
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // The client IP is resolved before any guard (AuthGuard, throttler) runs.
    consumer
      .apply(...bodyParsers(), clientIpMiddleware(this.config.CLIENT_IP_HMAC_SECRET))
      .forRoutes({ path: '{/*splat}', method: RequestMethod.ALL });
  }
}
