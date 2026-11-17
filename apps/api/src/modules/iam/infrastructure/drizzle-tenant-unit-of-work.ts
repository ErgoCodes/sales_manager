import type { Database } from '../../../infrastructure/db/database';
import { type TenantTransaction, withTenant } from '../../../infrastructure/db/with-tenant';
import type { IamTenantScope, TenantUnitOfWork } from '../domain/auth-ports';
import { ActorStateRepository } from './repositories/actor-state.repository';
import { AuditRepository } from './repositories/audit.repository';
import { DevicesRepository } from './repositories/devices.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { TenantsRepository } from './repositories/tenants.repository';
import { UsersRepository } from './repositories/users.repository';

/**
 * The only place that builds IAM repositories (ADR 0004): they take a
 * `TenantTransaction`, which only `withTenant` produces, and an ESLint rule
 * forbids importing `repositories/` from any other file. So every repository
 * call runs inside a transaction with `app.tenant_id` set, and RLS applies.
 */
export class DrizzleTenantUnitOfWork implements TenantUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (scope: IamTenantScope) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) => work(iamScope(tx, tenantId)));
  }
}

/** The authentication repositories on one tenant transaction (also the base of the admin scope). */
export function iamScope(tx: TenantTransaction, tenantId: string): IamTenantScope {
  return {
    users: new UsersRepository(tx),
    tenants: new TenantsRepository(tx),
    devices: new DevicesRepository(tx, tenantId),
    refreshTokens: new RefreshTokensRepository(tx, tenantId),
    audit: new AuditRepository(tx, tenantId),
    actors: new ActorStateRepository(tx),
  };
}
