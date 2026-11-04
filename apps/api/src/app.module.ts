import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { buildLoggerParams } from './common/logging/logger.config';
import { APP_CONFIG } from './config/app-config.token';
import type { AppConfig } from './config/env';
import { HealthModule } from './modules/health/health.module';

/**
 * Root module. It receives an already-validated config instead of reading
 * `process.env`, so `main.ts`, the OpenAPI generator and tests each decide
 * where the config comes from.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [LoggerModule.forRoot(buildLoggerParams(config)), HealthModule],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [APP_CONFIG],
    };
  }
}
