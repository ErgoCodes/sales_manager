import type { Database } from '../../../infrastructure/db/database';
import { withTenant } from '../../../infrastructure/db/with-tenant';
import { AssignmentsRepository } from '../../assignments/infrastructure/repositories/assignments.repository';
import { AuditEventsRepository } from '../../audit/infrastructure/repositories/audit-events.repository';
import { DeviceAdminRepositoryImpl } from '../../devices/infrastructure/repositories/device-admin.repository';
import { LocationsRepository } from '../../locations/infrastructure/repositories/locations.repository';
import { RolesRepository } from '../../roles/infrastructure/repositories/roles.repository';
import { UserAdminRepositoryImpl } from '../../users/infrastructure/repositories/user-admin.repository';
import type { AdminTenantScope, AdminUnitOfWork } from '../domain/admin-ports';
import { iamScope } from './drizzle-tenant-unit-of-work';
import { TenantsRepository } from './repositories/tenants.repository';

/**
 * Unit of work of the administration API (SP2·T4). Like
 * `DrizzleTenantUnitOfWork`, it is the only place that builds these
 * repositories, and only on a transaction `withTenant` opened (ESLint rule +
 * `TenantTransaction` brand, ADR 0004): every admin use case runs under RLS.
 */
export class DrizzleAdminUnitOfWork implements AdminUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (scope: AdminTenantScope) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) =>
      work({
        ...iamScope(tx, tenantId),
        mutex: new TenantsRepository(tx),
        locations: new LocationsRepository(tx, tenantId),
        userAdmin: new UserAdminRepositoryImpl(tx, tenantId),
        roles: new RolesRepository(tx, tenantId),
        assignments: new AssignmentsRepository(tx, tenantId),
        deviceAdmin: new DeviceAdminRepositoryImpl(tx),
        auditEvents: new AuditEventsRepository(tx),
      }),
    );
  }
}
