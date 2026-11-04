import { HealthResponse } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import type { AppConfig } from '../../src/config/env';
import { urls } from './helpers';

async function createApp(databaseUrl: string): Promise<NestExpressApplication> {
  const config: AppConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: ['http://localhost:3000'],
    LOG_LEVEL: 'silent',
    APP_VERSION: '9.9.9-it',
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, config);
  await app.init();
  return app;
}

describe('GET /health against real Postgres', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createApp(urls().app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports db: up as monaco_app', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(HealthResponse.parse(res.body)).toEqual({ status: 'ok', version: '9.9.9-it', db: 'up' });
  });

  it('reports db: down when the database is unreachable', async () => {
    const dead = new URL(urls().app);
    dead.port = '1';
    const broken = await createApp(dead.toString());
    try {
      const res = await request(broken.getHttpServer()).get('/health').expect(200);
      expect(HealthResponse.parse(res.body)).toEqual({ status: 'error', version: '9.9.9-it', db: 'down' });
    } finally {
      await broken.close();
    }
  });
});
