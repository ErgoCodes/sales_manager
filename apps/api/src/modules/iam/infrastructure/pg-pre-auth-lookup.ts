import { sql } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/database';
import type { PreAuthLookup } from '../domain/auth-ports';
import { toBytea } from './sql-helpers';

/**
 * The two pre-authentication doors (ADR 0003): SECURITY DEFINER functions owned
 * by monaco_auth, the only reads the API makes without a tenant. Everything
 * after them runs inside `withTenant`.
 */
export class PgPreAuthLookup implements PreAuthLookup {
  constructor(private readonly db: Pick<Database, 'execute'>) {}

  async findUserByEmail(email: string) {
    const { rows } = await this.db.execute<{ id: string; tenant_id: string; password_hash: string; status: string }>(
      sql`select id, tenant_id, password_hash, status from auth_lookup_user(${email})`,
    );
    const row = rows[0];
    return row ? { id: row.id, tenantId: row.tenant_id, passwordHash: row.password_hash, status: row.status } : null;
  }

  async findRefreshTenant(tokenHash: Uint8Array) {
    const { rows } = await this.db.execute<{ tenant_id: string }>(
      sql`select tenant_id from auth_lookup_refresh(${toBytea(tokenHash)})`,
    );
    const row = rows[0];
    return row ? { tenantId: row.tenant_id } : null;
  }
}
