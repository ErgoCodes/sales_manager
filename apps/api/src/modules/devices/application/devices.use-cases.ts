import type { Device, ListDevicesQuery, Paginated } from '@monaco/contracts';

import { type AdminRequest, iso, isoOrNull } from '../../iam/application/admin-support';
import { toAssignments } from '../../iam/application/authenticate.use-case';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import type { AdminTenantScope, AdminUnitOfWork } from '../../iam/domain/admin-ports';
import type { Clock } from '../../iam/domain/auth-ports';
import { PermissionDenied, ResourceNotFound } from '../../iam/domain/errors';
import { canManageDevicesOf } from '../../iam/domain/escalation';
import { hasPermissionAnywhere } from '../../iam/domain/permissions';
import type { DeviceRecord } from '../domain/device-admin-ports';

const toDevice = (record: DeviceRecord, actor: AuthenticatedActor): Device => ({
  id: record.id,
  userId: record.userId,
  label: record.label,
  platform: record.platform,
  createdAt: iso(record.createdAt),
  lastSeenAt: isoOrNull(record.lastSeenAt),
  revokedAt: isoOrNull(record.revokedAt),
  current: record.id === actor.deviceId,
});

/**
 * Own devices: any authenticated user. Someone else's: `devices:manage`, and
 * `canManageDevicesOf` (ADR 0005): tenant-wide holders reach anyone, a Manager
 * only users entirely inside its locations, and only an Owner reaches an Owner.
 */
async function assertCanManageDevicesOf(scope: AdminTenantScope, actor: AuthenticatedActor, userId: string): Promise<void> {
  if (userId === actor.userId) return;
  if (!(await scope.userAdmin.findById(userId))) throw new ResourceNotFound('user');
  if (!canManageDevicesOf(actor, toAssignments(await scope.assignments.listByUser(userId)))) throw new PermissionDenied('devices:manage');
}

function assertMayManageOthers(actor: AuthenticatedActor, userId: string): void {
  if (userId !== actor.userId && !hasPermissionAnywhere(actor.effective, 'devices:manage')) throw new PermissionDenied('devices:manage');
}

/** GET /devices: the caller's devices, or `userId`'s; newest first, `current` marks the calling device. */
export class ListDevices {
  constructor(private readonly uow: AdminUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: ListDevicesQuery): Promise<Paginated<Device>> {
    const userId = query.userId ?? actor.userId;
    assertMayManageOthers(actor, userId);
    const result = await this.uow.run(actor.tenantId, async (scope) => {
      await assertCanManageDevicesOf(scope, actor, userId);
      return scope.deviceAdmin.listByUser(userId, { cursor: query.cursor, limit: query.limit });
    });
    return { items: result.items.map((record) => toDevice(record, actor)), nextCursor: result.nextCursor };
  }
}

/**
 * POST /devices/:id/revoke. Revokes the device and then every token on it
 * (lock order: device, then tokens): its access token gets 401 on the next
 * request. Idempotent; only the first revocation is audited.
 */
export class RevokeDevice {
  constructor(
    private readonly uow: AdminUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, ip }: AdminRequest, id: string): Promise<Device> {
    const now = this.clock.now();
    const record = await this.uow.run(actor.tenantId, async (scope) => {
      const device = await scope.deviceAdmin.findById(id);
      if (!device) throw new ResourceNotFound('device');
      assertMayManageOthers(actor, device.userId);
      await assertCanManageDevicesOf(scope, actor, device.userId);
      const revoked = (await scope.deviceAdmin.revoke(id, now))!;
      if (revoked.revokedAt?.getTime() !== now.getTime()) return revoked;
      await scope.refreshTokens.revokeByDevices([id], 'device_revoked', now);
      await scope.audit.record({ type: 'device_revoked', actorUserId: actor.userId, targetType: 'device', targetId: id, metadata: { userId: device.userId }, ip });
      return revoked;
    });
    return toDevice(record, actor);
  }
}
