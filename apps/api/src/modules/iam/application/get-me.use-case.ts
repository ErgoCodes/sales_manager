import type { MeResponse } from '@monaco/contracts';

import type { AuthenticatedActor } from '../domain/actor';
import { InvalidSession } from '../domain/auth-errors';
import type { TenantUnitOfWork } from '../domain/auth-ports';
import { toGrants } from '../domain/permissions';

/** GET /me: who am I, in which tenant, and what may I do (for hiding UI; the API stays the authority). */
export class GetMe {
  constructor(private readonly uow: TenantUnitOfWork) {}

  async execute(actor: AuthenticatedActor): Promise<MeResponse> {
    const { user, tenant } = await this.uow.run(actor.tenantId, async (scope) => ({
      user: await scope.users.findById(actor.userId),
      tenant: await scope.tenants.findCurrent(),
    }));
    if (!user || !tenant) throw new InvalidSession();
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, mustChangePassword: user.mustChangePassword },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      deviceId: actor.deviceId,
      permissions: toGrants(actor.effective).map((grant) => ({
        permission: grant.permission,
        scope: grant.scope.type === 'tenant' ? { type: 'tenant' } : { type: 'locations', locationIds: [...grant.scope.locationIds] },
      })),
    };
  }
}
