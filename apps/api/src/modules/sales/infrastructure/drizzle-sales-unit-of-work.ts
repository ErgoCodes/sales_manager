import type { Database } from '../../../infrastructure/db/database';
import { withTenant } from '../../../infrastructure/db/with-tenant';
import { AuditRepository } from '../../iam/infrastructure/repositories/audit.repository';
import { InventoryLedgerRepository } from '../../inventory/infrastructure/repositories/inventory-ledger.repository';
import { InventoryReaderRepository } from '../../inventory/infrastructure/repositories/inventory-reader.repository';
import type { SalesScope, SalesUnitOfWork } from '../domain/sales-ports';
import { SalesDrizzleRepository } from './repositories/sales.repository';

/**
 * The only place that builds the sales repositories: the inventory ledger (the `sale`
 * document goes through the ADR 0006 script) and the sales tables, on the same
 * `withTenant` transaction (RLS, READ COMMITTED like the inventory writes).
 */
export class DrizzleSalesUnitOfWork implements SalesUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (scope: SalesScope) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) =>
      work({
        ledger: new InventoryLedgerRepository(tx, tenantId),
        reader: new InventoryReaderRepository(tx, tenantId),
        audit: new AuditRepository(tx, tenantId),
        sales: new SalesDrizzleRepository(tx, tenantId),
      }),
    );
  }
}
