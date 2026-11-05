import { ErrorResponse, HealthResponse } from '@monaco/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { createOpenApiDocument } from '../common/openapi/openapi';
import type { AppConfig } from '../config/env';
import { DATABASE } from '../infrastructure/db/database.tokens';
import { testConfig } from './test-config';

const config: AppConfig = testConfig({ DATABASE_URL: 'postgres://test:test@localhost:5432/test' });

// Hermetic: the real Drizzle health adapter runs against a fake database, so
// these tests never depend on a local Postgres (that is SP1·T5's job).
let databaseUp = false;
const fakeDatabase = {
  execute: async () => {
    if (!databaseUp) throw new Error('ECONNREFUSED');
    return { rows: [{ '?column?': 1 }] };
  },
};

describe('API (in-process HTTP)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(DATABASE)
      .useValue(fakeDatabase)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health answers with the HealthResponse contract and reports the database state', async () => {
    databaseUp = false;
    const down = await request(app.getHttpServer()).get('/health').expect(200);
    expect(HealthResponse.parse(down.body)).toEqual({ status: 'error', version: '9.9.9-test', db: 'down' });

    databaseUp = true;
    const up = await request(app.getHttpServer()).get('/health').expect(200);
    expect(HealthResponse.parse(up.body)).toEqual({ status: 'ok', version: '9.9.9-test', db: 'up' });
    databaseUp = false;
  });

  it('tags every response with a request id and reuses a well-formed incoming one', async () => {
    const minted = await request(app.getHttpServer()).get('/health');
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await request(app.getHttpServer()).get('/health').set('x-request-id', 'edge-123');
    expect(reused.headers['x-request-id']).toBe('edge-123');

    const rejected = await request(app.getHttpServer()).get('/health').set('x-request-id', 'bad id with spaces');
    expect(rejected.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('returns ErrorResponse for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('rejects bodies over the limit and malformed JSON with ErrorResponse and a request id', async () => {
    const big = await request(app.getHttpServer())
      .post('/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200 * 1024) }))
      .expect(413);
    expect(ErrorResponse.parse(big.body).error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
    expect(big.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const malformed = await request(app.getHttpServer())
      .post('/health')
      .set('content-type', 'application/json')
      .set('x-request-id', 'edge-400')
      .send('{"password":"s3cret"')
      .expect(400);
    expect(ErrorResponse.parse(malformed.body).error).toEqual({ code: 'BAD_REQUEST', message: 'Malformed JSON body' });
    expect(malformed.headers['x-request-id']).toBe('edge-400');
    expect(JSON.stringify(malformed.body)).not.toContain('s3cret');
  });

  it('does not echo the query string in 404 messages', async () => {
    const res = await request(app.getHttpServer()).get('/nope?token=abc').expect(404);
    expect(res.body.error.message).toBe('Cannot GET /nope');
  });

  it('allows only allow-listed CORS origins', async () => {
    const allowed = await request(app.getHttpServer()).get('/health').set('origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await request(app.getHttpServer()).get('/health').set('origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets helmet security headers and hides x-powered-by', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  // Guards the Zod ↔ nestjs-zod pairing (ADR 0001): a contract id must become a named component.
  it('documents /health and errors in OpenAPI with named $ref components', () => {
    const document = createOpenApiDocument(app);
    type Responses = Record<string, { content: Record<string, { schema: { $ref: string } }> }>;
    const responses = document.paths['/health']?.get?.responses as Responses;
    expect(responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/HealthResponse_Output',
    );
    expect(responses.default.content['application/json'].schema.$ref).toBe('#/components/schemas/ErrorResponse');
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ErrorResponse', 'HealthResponse_Output', 'LoginRequest', 'AuthTokens_Output', 'MeResponse_Output']),
    );
  });

  it('documents the auth endpoints, with bearer auth on the protected ones', () => {
    const document = createOpenApiDocument(app);
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/password', '/me']));
    expect(document.paths['/me']?.get?.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/auth/login']?.post?.security).toBeUndefined();
    expect(document.components?.securitySchemes?.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('requires a bearer token everywhere but the public routes (401 ErrorResponse)', async () => {
    const missing = await request(app.getHttpServer()).get('/me').expect(401);
    expect(ErrorResponse.parse(missing.body).error).toEqual({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    await request(app.getHttpServer()).get('/me').set('authorization', 'Basic abc').expect(401);
    await request(app.getHttpServer()).post('/auth/logout').set('authorization', 'Bearer a.b.c').expect(401);
  });
});
