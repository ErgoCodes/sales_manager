import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { AppConfig } from './config/env';

export const BODY_LIMIT = '100kb';

/**
 * HTTP hardening shared by `main.ts` and the e2e tests, so tests exercise the
 * same middleware stack as production.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): NestExpressApplication {
  app.disable('x-powered-by');
  app.use(helmet());
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: false });
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
  return app;
}
