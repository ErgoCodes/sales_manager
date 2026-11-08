import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Keeps the hexagonal boundary rule (ADR 0001) honest: if someone loosens
// eslint.config.js, these fail.
const eslint = new ESLint({ cwd: resolve(__dirname, '../..') });

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

const domainFile = 'src/modules/health/domain/probe.ts';
const applicationFile = 'src/modules/health/application/probe.ts';

describe('hexagonal import boundaries', () => {
  it.each([
    ["import { sql } from 'drizzle-orm';"],
    ["import { Injectable } from '@nestjs/common';"],
    ["import { createZodDto } from 'nestjs-zod';"],
    ["import { Pool } from 'pg';"],
    ["import { DrizzleDatabaseHealthAdapter } from '../infrastructure/drizzle-database-health.adapter';"],
    ["import { HealthController } from '../http/health.controller';"],
    ["import { CheckHealth } from '../application/check-health.use-case';"],
    ["import { HealthModule } from '../health.module';"],
    ["import { DATABASE_HEALTH_PORT } from '../health.tokens';"],
    ["import { AppModule } from '../../../app.module';"],
    ["import { configureApp } from '../../../bootstrap';"],
    ["import { AllExceptionsFilter } from '../../../common/http/all-exceptions.filter';"],
    ["import { APP_CONFIG } from '../../../config/app-config.token';"],
  ])('domain/ rejects %s', async (code) => {
    expect(await restrictedImports(domainFile, `${code}\nexport {};\n`)).not.toEqual([]);
  });

  it.each([
    ["import { sql } from 'drizzle-orm';"],
    ["import { Injectable } from '@nestjs/common';"],
    ["import { HealthController } from '../http/health.controller';"],
    ["import { HealthModule } from '../health.module';"],
    ["import { DATABASE_HEALTH_PORT } from '../health.tokens';"],
    ["import { buildLoggerParams } from '../../../common/logging/logger.config';"],
    ["import { loadConfig } from '../../../config/env';"],
    ["import { createOpenApiDocument } from '../../../scripts/generate-openapi';"],
  ])('application/ rejects %s', async (code) => {
    expect(await restrictedImports(applicationFile, `${code}\nexport {};\n`)).not.toEqual([]);
  });

  it('covers the iam module: its domain cannot reach frameworks or outer layers', async () => {
    const iamDomain = 'src/modules/iam/domain/probe.ts';
    for (const code of [
      "import { Injectable } from '@nestjs/common';",
      "import { sql } from 'drizzle-orm';",
      "import { IamRepository } from '../infrastructure/iam.repository';",
      "import { UsersController } from '../http/users.controller';",
      "import { IamModule } from '../iam.module';",
    ]) {
      expect(await restrictedImports(iamDomain, `${code}\nexport {};\n`), code).not.toEqual([]);
    }
    const allowed = "import { PERMISSIONS } from '@monaco/contracts';\nexport const p = PERMISSIONS;\n";
    expect(await restrictedImports(iamDomain, allowed)).toEqual([]);
  });

  it('only the unit-of-work adapter (and the repositories themselves) can import tenant repositories', async () => {
    const code = "import { UsersRepository } from './repositories/users.repository';\nexport const r = UsersRepository;\n";
    for (const file of [
      'src/modules/iam/infrastructure/pg-pre-auth-lookup.ts',
      'src/modules/iam/http/me.controller.ts',
      'src/modules/iam/iam.module.ts',
      'src/infrastructure/db/probe.ts',
      'test/integration/probe.test.ts',
    ]) {
      expect(await restrictedImports(resolve(__dirname, '../..', file), code), file).not.toEqual([]);
    }
    expect(await restrictedImports(resolve(__dirname, '../..', 'src/modules/iam/infrastructure/drizzle-tenant-unit-of-work.ts'), code)).toEqual([]);
    expect(await restrictedImports(resolve(__dirname, '../..', 'src/modules/iam/infrastructure/repositories/probe.ts'), code)).toEqual([]);
  });

  it('allows ports and @monaco/domain in inner layers', async () => {
    const code = [
      "import type { DatabaseHealthPort } from '../domain/database-health.port';",
      "import { calculateProfit } from '@monaco/domain';",
      'export type X = DatabaseHealthPort;',
      'export const y = calculateProfit;',
    ].join('\n');
    expect(await restrictedImports(applicationFile, code)).toEqual([]);
  });
});
