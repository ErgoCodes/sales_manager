import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { AppConfig } from './config/env';

/**
 * HTTP hardening shared by `main.ts` and the e2e tests, so tests exercise the
 * same middleware stack as production. The app must be created with
 * `bodyParser: false`: body parsers (with the size limit) are Nest middleware
 * in AppModule so they run after request-id/logging.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): NestExpressApplication {
  app.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
  return app;
}
