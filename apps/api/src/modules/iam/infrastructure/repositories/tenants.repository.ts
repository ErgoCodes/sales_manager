import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { TenantMutex } from '../../domain/admin-ports';
import type { TenantRecord, TenantRepository } from '../../domain/auth-ports';
import { rows } from '../sql-helpers';

export class TenantsRepository implements TenantRepository, TenantMutex {
  constructor(private readonly tx: TenantTransaction) {}

  /** RLS on `tenants` keys on `id`: inside the unit of work only the current tenant is visible. */
  async findCurrent(): Promise<TenantRecord | null> {
    const [row] = await rows<TenantRecord>(this.tx, sql`select id, name, slug from tenants`);
    return row ?? null;
  }

  /**
   * The per-tenant mutex (ADR 0005 §5). monaco_app holds UPDATE only on
   * tenants.name, which is all `FOR UPDATE` needs (migration 0006). Lock order
   * everywhere: tenant, then devices, then refresh tokens.
   */
  async lock(): Promise<void> {
    await this.tx.execute(sql`select 1 from tenants for update`);
  }
}
