import type { Database } from '../../../infrastructure/db/database';
import { withTenant } from '../../../infrastructure/db/with-tenant';
import { AuditRepository } from '../../iam/infrastructure/repositories/audit.repository';
import type { CatalogTenantScope, CatalogUnitOfWork } from '../domain/catalog-ports';
import { LocationPricesRepository } from './repositories/location-prices.repository';
import { ProductsRepository } from './repositories/products.repository';

/**
 * Unit of work of the catalog (SP3·T4): the only place that builds its
 * repositories, and only on a transaction `withTenant` opened (ESLint rule +
 * `TenantTransaction` brand, ADR 0004), so every catalog use case runs under RLS.
 */
export class DrizzleCatalogUnitOfWork implements CatalogUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (scope: CatalogTenantScope) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) =>
      work({
        products: new ProductsRepository(tx, tenantId),
        locationPrices: new LocationPricesRepository(tx, tenantId),
        audit: new AuditRepository(tx, tenantId),
      }),
    );
  }
}
