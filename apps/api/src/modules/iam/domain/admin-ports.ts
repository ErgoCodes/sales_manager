import type { AssignmentRepository } from '../../assignments/domain/assignment-ports';
import type { AuditEventReader } from '../../audit/domain/audit-ports';
import type { DeviceAdminRepository } from '../../devices/domain/device-admin-ports';
import type { LocationRepository } from '../../locations/domain/location-ports';
import type { RoleRepository } from '../../roles/domain/role-ports';
import type { UserAdminRepository } from '../../users/domain/user-admin-ports';
import type { IamTenantScope } from './auth-ports';

/** Cursor pagination: an opaque cursor issued by the same listing, and a page size. */
export interface PageRequest {
  readonly cursor?: string;
  readonly limit: number;
}

/**
 * Per-tenant mutex of the Owner invariant (ADR 0005 §5): `SELECT ... FROM
 * tenants ... FOR UPDATE` on the current tenant's row. Every mutation that can
 * affect an Owner takes it before reading the state it validates, so two
 * concurrent requests cannot both remove "the other" last Owner.
 */
export interface TenantMutex {
  lock(): Promise<void>;
}

/** Repositories of the administration API, bound to one tenant-scoped transaction. */
export interface AdminTenantScope extends IamTenantScope {
  readonly mutex: TenantMutex;
  readonly locations: LocationRepository;
  readonly userAdmin: UserAdminRepository;
  readonly roles: RoleRepository;
  readonly assignments: AssignmentRepository;
  readonly deviceAdmin: DeviceAdminRepository;
  readonly auditEvents: AuditEventReader;
}

/** Same contract as `TenantUnitOfWork`, with the administration repositories. */
export interface AdminUnitOfWork {
  run<T>(tenantId: string, work: (scope: AdminTenantScope) => Promise<T>): Promise<T>;
}
