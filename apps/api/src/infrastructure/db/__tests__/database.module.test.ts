import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { AppConfigModule } from '../../../config/app-config.module';
import type { AppConfig } from '../../../config/env';
import { DATABASE, PG_POOL } from '../database.tokens';
import { DatabaseModule } from '../database.module';

const config = {
  DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
} as AppConfig;

describe('DatabaseModule', () => {
  it('builds a lazy pool (no connection on startup) and ends it on shutdown', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule.forRoot(config), DatabaseModule],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();

    const pool = app.get<Pool>(PG_POOL);
    expect(app.get(DATABASE)).toBeDefined();
    expect(pool.totalCount).toBe(0);
    expect(pool.options).toMatchObject({ max: 10, connectionTimeoutMillis: 5_000, application_name: 'monaco-api' });
    // An idle-client error is logged, not thrown (it would crash the process).
    expect(() => pool.emit('error', new Error('terminated'))).not.toThrow();

    await app.close();
    expect(pool.ended).toBe(true);
  });
});
