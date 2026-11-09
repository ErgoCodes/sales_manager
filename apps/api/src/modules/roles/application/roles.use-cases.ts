import type { CreateRoleRequest, Paginated, Role, UpdateRoleRequest } from '@monaco/contracts';

import { type AdminRequest, iso, runAdmin } from '../../iam/application/admin-support';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import type { AdminUnitOfWork, PageRequest } from '../../iam/domain/admin-ports';
import type { Clock } from '../../iam/domain/auth-ports';
import { ResourceNotFound } from '../../iam/domain/errors';
import { assertNoEscalation } from '../../iam/domain/escalation';
import { assertOwnerInvariant, assertRoleDeletable } from '../../iam/domain/owner';
import { authorize } from '../../iam/domain/permissions';
import type { RoleRecord } from '../domain/role-ports';

const toRole = (record: RoleRecord): Role => ({
  id: record.id,
  key: record.key,
  name: record.name,
  isSystem: record.isSystem,
  permissions: [...record.permissions],
  createdAt: iso(record.createdAt),
});

/** GET /roles (`roles:manage`). */
export class ListRoles {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(actor: AuthenticatedActor, page: PageRequest): Promise<Paginated<Role>> {
    authorize(actor, 'roles:manage');
    const result = await this.uow.run(actor.tenantId, (scope) => scope.roles.list(page));
    return { items: result.items.map(toRole), nextCursor: result.nextCursor };
  }
}

/** POST /roles (`roles:manage`): the actor may only put in it what they hold tenant-wide (ADR 0005 §4). */
export class CreateRole {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, input: CreateRoleRequest): Promise<Role> {
    const { actor, ip } = request;
    authorize(actor, 'roles:manage');
    const now = this.clock.now();
    const record = await runAdmin(this.uow, request, 'create_role', { type: 'role' }, async (scope) => {
      assertNoEscalation(actor, { kind: 'create_role', permissions: input.permissions });
      const created = await scope.roles.create({ ...input, now });
      await scope.audit.record({
        type: 'role_created',
        actorUserId: actor.userId,
        targetType: 'role',
        targetId: created.id,
        metadata: { name: created.name, permissions: created.permissions },
        ip,
      });
      return created;
    });
    return toRole(record);
  }
}

/**
 * PATCH /roles/:id (`roles:manage`). The change affects every holder, so the
 * actor must cover every added AND removed permission; the Owner role is
 * immutable (409). Takes the tenant mutex like every mutation that could touch
 * an Owner.
 */
export class UpdateRole {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(request: AdminRequest, id: string, changes: UpdateRoleRequest): Promise<Role> {
    const { actor, ip } = request;
    authorize(actor, 'roles:manage');
    const record = await runAdmin(this.uow, request, 'update_role', { type: 'role', id }, async (scope) => {
      await scope.mutex.lock();
      const role = await scope.roles.findById(id);
      if (!role) throw new ResourceNotFound('role');
      assertNoEscalation(actor, {
        kind: 'update_role',
        role,
        permissions: changes.permissions ?? role.permissions,
        hasLocationScopedAssignments: await scope.assignments.hasLocationScopedByRole(id),
      });
      const updated = await scope.roles.update(id, changes);
      assertOwnerInvariant(await scope.assignments.ownerCandidates());
      await scope.audit.record({
        type: 'role_updated',
        actorUserId: actor.userId,
        targetType: 'role',
        targetId: id,
        metadata: { before: { name: role.name, permissions: role.permissions }, after: { name: updated.name, permissions: updated.permissions } },
        ip,
      });
      return updated;
    });
    return toRole(record);
  }
}

/**
 * DELETE /roles/:id (`roles:manage`). System roles and roles in use are never
 * deleted (409). Deleting takes permissions away like an edit would, so the
 * actor must be able to create this role (cover all its permissions).
 */
export class DeleteRole {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(request: AdminRequest, id: string): Promise<void> {
    const { actor, ip } = request;
    authorize(actor, 'roles:manage');
    await runAdmin(this.uow, request, 'delete_role', { type: 'role', id }, async (scope) => {
      await scope.mutex.lock();
      const role = await scope.roles.findById(id);
      if (!role) throw new ResourceNotFound('role');
      assertRoleDeletable(role, await scope.assignments.countByRole(id));
      assertNoEscalation(actor, { kind: 'create_role', permissions: role.permissions });
      await scope.roles.delete(id);
      assertOwnerInvariant(await scope.assignments.ownerCandidates());
      await scope.audit.record({
        type: 'role_deleted',
        actorUserId: actor.userId,
        targetType: 'role',
        targetId: id,
        metadata: { name: role.name, permissions: role.permissions },
        ip,
      });
    });
  }
}
