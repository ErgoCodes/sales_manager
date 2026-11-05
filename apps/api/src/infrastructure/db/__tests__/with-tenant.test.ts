import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../database';
import { InvalidTenantIdError, withTenant } from '../with-tenant';

const TENANT = '0f8c4a52-7e1b-4c1e-9a7d-2b9f6c3e5d10';

function fakeDatabase() {
  const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
  const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return { db: { transaction } as unknown as Database, tx, transaction };
}

describe('withTenant', () => {
  it('sets app.tenant_id as a transaction-local bind parameter before running fn', async () => {
    const { db, tx, transaction } = fakeDatabase();
    const fn = vi.fn(async () => {
      expect(tx.execute).toHaveBeenCalledTimes(1);
      return 'result';
    });

    await expect(withTenant(db, TENANT, fn)).resolves.toBe('result');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(tx);
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0]?.[0] as SQL);
    // Never interpolated: the tenant id travels only in params.
    expect(query).toMatchObject({ sql: 'select set_config($1, $2, true)', params: ['app.tenant_id', TENANT] });
  });

  it('propagates errors from fn so the transaction rolls back', async () => {
    const { db } = fakeDatabase();
    await expect(withTenant(db, TENANT, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it.each(['', 'not-a-uuid', `${TENANT}'; reset role; --`, `${TENANT} `, '0f8c4a527e1b4c1e9a7d2b9f6c3e5d10'])(
    'rejects %j before opening a transaction',
    async (tenantId) => {
      const { db, transaction } = fakeDatabase();
      await expect(withTenant(db, tenantId, async () => 'never')).rejects.toBeInstanceOf(InvalidTenantIdError);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
