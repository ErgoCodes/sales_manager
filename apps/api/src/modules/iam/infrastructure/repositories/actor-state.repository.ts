import { PERMISSIONS, type Permission, type SystemRoleKey } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { ActorState, ActorStateReader, StoredAssignment } from '../../domain/auth-ports';
import { rows } from '../sql-helpers';

interface Row {
  status: string;
  mustChangePassword: boolean;
  deviceActive: boolean;
  sessionActive: boolean;
  assignments: {
    roleId: string;
    roleKey: SystemRoleKey | null;
    isSystem: boolean;
    scope: 'tenant' | 'locations';
    permissions: string[];
    locationIds: string[];
  }[];
}

const CATALOG = new Set<string>(PERMISSIONS);

/**
 * The per-request check of the AuthGuard, in ONE indexed query: user state,
 * device not revoked, session (refresh family) still alive, and every
 * assignment with its role's permissions and its non-archived locations.
 */
export class ActorStateRepository implements ActorStateReader {
  constructor(private readonly tx: TenantTransaction) {}

  async load(userId: string, deviceId: string, sessionId: string): Promise<ActorState | null> {
    const [row] = await rows<Row>(
      this.tx,
      sql`select u.status, u.must_change_password as "mustChangePassword",
                 d.revoked_at is null as "deviceActive",
                 exists (select 1 from refresh_tokens r
                         where r.tenant_id = d.tenant_id and r.family_id = ${sessionId}
                           and r.device_id = d.id and r.revoked_at is null) as "sessionActive",
                 coalesce((
                   select json_agg(json_build_object(
                            'roleId', ro.id, 'roleKey', ro.key, 'isSystem', ro.is_system, 'scope', a.scope,
                            'permissions', coalesce((select json_agg(rp.permission) from role_permissions rp
                                                     where rp.role_id = ro.id and rp.tenant_id = ro.tenant_id), '[]'::json),
                            'locationIds', coalesce((select json_agg(l.location_id) from role_assignment_locations l
                                                     join locations loc on loc.id = l.location_id and loc.tenant_id = l.tenant_id
                                                     where l.assignment_id = a.id and l.tenant_id = a.tenant_id
                                                       and loc.archived_at is null), '[]'::json)))
                   from role_assignments a
                   join roles ro on ro.id = a.role_id and ro.tenant_id = a.tenant_id
                   where a.user_id = u.id and a.tenant_id = u.tenant_id), '[]'::json) as assignments
          from users u
          join devices d on d.id = ${deviceId} and d.user_id = u.id and d.tenant_id = u.tenant_id
          where u.id = ${userId}`,
    );
    if (!row) return null;
    return {
      userActive: row.status === 'active',
      mustChangePassword: row.mustChangePassword,
      deviceActive: row.deviceActive,
      sessionActive: row.sessionActive,
      assignments: row.assignments.map(
        (a): StoredAssignment => ({
          roleId: a.roleId,
          roleKey: a.roleKey,
          isSystem: a.isSystem,
          scope: a.scope,
          // The CHECK constraint already enforces the catalog; this keeps the type honest.
          permissions: a.permissions.filter((p): p is Permission => CATALOG.has(p)),
          locationIds: a.locationIds,
        }),
      ),
    };
  }
}
