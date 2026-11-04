import 'reflect-metadata';

import { existsSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { createOpenApiDocument } from './common/openapi/openapi';
import { loadConfig } from './config/env';

async function bootstrap(): Promise<void> {
  // Local convenience only; in containers the environment is injected.
  if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    // Body parsers are Nest middleware in AppModule (after request-id/logging).
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  configureApp(app, config);

  if (config.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, createOpenApiDocument(app));
  }

  await app.listen(config.PORT);
  app.get(Logger).log(`API listening on :${config.PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // The pino logger may not exist yet (e.g. invalid env), so fall back to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
