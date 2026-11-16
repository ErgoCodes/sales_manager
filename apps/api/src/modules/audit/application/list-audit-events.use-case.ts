import type { AuditEvent, Paginated } from '@monaco/contracts';

import { iso } from '../../iam/application/admin-support';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import type { AdminUnitOfWork, PageRequest } from '../../iam/domain/admin-ports';
import { authorize } from '../../iam/domain/permissions';

/** GET /audit-events (`audit:view`, tenant-wide): the tenant's security log, newest first. */
export class ListAuditEvents {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(actor: AuthenticatedActor, page: PageRequest): Promise<Paginated<AuditEvent>> {
    authorize(actor, 'audit:view');
    const result = await this.uow.run(actor.tenantId, (scope) => scope.auditEvents.list(page));
    return { items: result.items.map((event) => ({ ...event, createdAt: iso(event.createdAt) })), nextCursor: result.nextCursor };
  }
}
