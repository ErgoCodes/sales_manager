import 'reflect-metadata';

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { createOpenApiDocument } from '../common/openapi/openapi';
import type { AppConfig } from '../config/env';
import { generateSigningJwk } from '../config/signing-keys';

/**
 * Writes the OpenAPI document without opening a port or touching a database.
 * The config is a fixed placeholder so the output depends only on the code
 * (the signing key is ephemeral and never appears in the document).
 * Usage: node dist/scripts/generate-openapi.js <output.json>
 */
const PLACEHOLDER_CONFIG: AppConfig = {
  NODE_ENV: 'production',
  PORT: 4000,
  DATABASE_URL: 'postgres://openapi:openapi@localhost:5432/openapi',
  CORS_ORIGINS: ['http://localhost:3000'],
  LOG_LEVEL: 'silent',
  APP_VERSION: 'openapi',
  JWT_PRIVATE_JWK: generateSigningJwk('openapi').privateJwk,
  JWT_ISSUER: 'monaco-api',
  JWT_AUDIENCE: 'monaco',
};

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: generate-openapi <output.json>');

  const app = await NestFactory.create(AppModule.forRoot(PLACEHOLDER_CONFIG), { logger: false });
  try {
    const document = createOpenApiDocument(app);
    writeFileSync(resolve(output), `${JSON.stringify(document, null, 2)}\n`);
    console.log(`OpenAPI written to ${resolve(output)}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
