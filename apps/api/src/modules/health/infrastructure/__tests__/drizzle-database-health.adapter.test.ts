import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { DrizzleDatabaseHealthAdapter } from '../drizzle-database-health.adapter';

describe('DrizzleDatabaseHealthAdapter', () => {
  it('pings with select 1 and resolves true', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await expect(new DrizzleDatabaseHealthAdapter({ execute }).ping()).resolves.toBe(true);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(query).toMatchObject({ sql: 'select 1', params: [] });
  });

  it('propagates connection errors (CheckHealth maps them to down)', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new DrizzleDatabaseHealthAdapter({ execute }).ping()).rejects.toThrow('ECONNREFUSED');
  });
});
