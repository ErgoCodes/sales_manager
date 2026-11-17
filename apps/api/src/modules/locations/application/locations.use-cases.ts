import type { CreateLocationRequest, Location, Paginated, UpdateLocationRequest } from '@monaco/contracts';

import { type AdminRequest, iso, isoOrNull } from '../../iam/application/admin-support';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import type { AdminUnitOfWork, PageRequest } from '../../iam/domain/admin-ports';
import type { Clock } from '../../iam/domain/auth-ports';
import { ResourceNotFound } from '../../iam/domain/errors';
import { authorize } from '../../iam/domain/permissions';
import type { LocationRecord } from '../domain/location-ports';

const toLocation = (record: LocationRecord): Location => ({
  id: record.id,
  name: record.name,
  code: record.code,
  archivedAt: isoOrNull(record.archivedAt),
  createdAt: iso(record.createdAt),
});

/**
 * GET /locations: any authenticated user, filtered by scope. Someone holding
 * any permission tenant-wide sees every location; a locations-scoped user
 * (cashier, manager) only the ones they hold a permission in.
 */
export class ListLocations {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(actor: AuthenticatedActor, page: PageRequest): Promise<Paginated<Location>> {
    const onlyIds = actor.effective.tenantWide.size > 0 ? undefined : [...actor.effective.byLocation.keys()];
    const result = await this.uow.run(actor.tenantId, (scope) => scope.locations.list({ ...page, onlyIds }));
    return { items: result.items.map(toLocation), nextCursor: result.nextCursor };
  }
}

/** POST /locations (`locations:manage`, tenant-wide only). A duplicate code is a 409 from the unique index. */
export class CreateLocation {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, input: CreateLocationRequest): Promise<Location> {
    authorize(actor, 'locations:manage');
    const now = this.clock.now();
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const created = await scope.locations.create({ ...input, now });
      await scope.audit.record({ type: 'location_created', actorUserId: actor.userId, targetType: 'location', targetId: created.id, metadata: { ...input }, ip });
      return created;
    });
    return toLocation(record);
  }
}

/** PATCH /locations/:id (`locations:manage`). */
export class UpdateLocation {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute({ actor, ip }: AdminRequest, id: string, changes: UpdateLocationRequest): Promise<Location> {
    authorize(actor, 'locations:manage');
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const updated = await scope.locations.update(id, changes);
      if (!updated) throw new ResourceNotFound('location');
      await scope.audit.record({ type: 'location_updated', actorUserId: actor.userId, targetType: 'location', targetId: id, metadata: { ...changes }, ip });
      return updated;
    });
    return toLocation(record);
  }
}

/** POST /locations/:id/archive (`locations:manage`). Idempotent: the first archive date is kept. */
export class ArchiveLocation {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, id: string): Promise<Location> {
    authorize(actor, 'locations:manage');
    const now = this.clock.now();
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const archived = await scope.locations.archive(id, now);
      if (!archived) throw new ResourceNotFound('location');
      // Archiving again is a no-op (the first date is kept): nothing to audit.
      if (archived.archivedAt?.getTime() !== now.getTime()) return archived;
      await scope.audit.record({ type: 'location_archived', actorUserId: actor.userId, targetType: 'location', targetId: id, ip });
      return archived;
    });
    return toLocation(record);
  }
}
