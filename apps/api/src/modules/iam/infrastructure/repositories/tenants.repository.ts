import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { TenantRecord, TenantRepository } from '../../domain/auth-ports';
import { rows } from '../sql-helpers';

export class TenantsRepository implements TenantRepository {
  constructor(private readonly tx: TenantTransaction) {}

  /** RLS on `tenants` keys on `id`: inside the unit of work only the current tenant is visible. */
  async findCurrent(): Promise<TenantRecord | null> {
    const [row] = await rows<TenantRecord>(this.tx, sql`select id, name, slug from tenants`);
    return row ?? null;
  }
}
