import type { Database } from '../../../infrastructure/db/database';
import { withTenant } from '../../../infrastructure/db/with-tenant';
import { AuditRepository } from '../../iam/infrastructure/repositories/audit.repository';
import type { InventoryScope, InventoryUnitOfWork } from '../domain/inventory-ports';
import { InventoryLedgerRepository } from './repositories/inventory-ledger.repository';

/**
 * The only place that builds the inventory repositories (ADR 0004): on a
 * transaction `withTenant` opened, so every statement runs under RLS with the
 * default READ COMMITTED isolation the ADR 0006 locking script relies on.
 */
export class DrizzleInventoryUnitOfWork implements InventoryUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (scope: InventoryScope) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) =>
      work({ ledger: new InventoryLedgerRepository(tx, tenantId), audit: new AuditRepository(tx, tenantId) }),
    );
  }
}
