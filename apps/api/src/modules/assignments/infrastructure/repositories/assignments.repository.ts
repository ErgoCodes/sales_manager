import type { SystemRoleKey } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { OwnerCandidate } from '../../../iam/domain/owner';
import { SYSTEM_ROLES } from '../../../iam/domain/system-roles';
import type { Scope } from '../../../iam/domain/types';
import { filterCatalogPermissions, rows } from '../../../iam/infrastructure/sql-helpers';
import type { AssignmentInput, AssignmentRepository, SavedAssignment, StoredAssignmentWithId } from '../../domain/assignment-ports';

interface Row {
  id: string;
  roleId: string;
  roleKey: SystemRoleKey | null;
  isSystem: boolean;
  scope: 'tenant' | 'locations';
  permissions: string[];
  locationIds: string[];
}

export class AssignmentsRepository implements AssignmentRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  /** Same shape as the AuthGuard's per-request read (actor-state.repository.ts), for one target user. */
  async listByUser(userId: string): Promise<StoredAssignmentWithId[]> {
    const found = await rows<Row>(
      this.tx,
      sql`select a.id, a.role_id as "roleId", ro.key as "roleKey", ro.is_system as "isSystem", a.scope,
                 coalesce((select json_agg(rp.permission) from role_permissions rp
                           where rp.role_id = ro.id and rp.tenant_id = ro.tenant_id), '[]'::json) as permissions,
                 coalesce((select json_agg(l.location_id order by l.location_id) from role_assignment_locations l
                           join locations loc on loc.id = l.location_id and loc.tenant_id = l.tenant_id
                           where l.assignment_id = a.id and l.tenant_id = a.tenant_id
                             and loc.archived_at is null), '[]'::json) as "locationIds"
          from role_assignments a
          join roles ro on ro.id = a.role_id and ro.tenant_id = a.tenant_id
          where a.user_id = ${userId}
          order by a.id`,
    );
    return found.map((row) => ({ ...row, permissions: filterCatalogPermissions(row.permissions) }));
  }

  async replace(userId: string, next: readonly AssignmentInput[], now: Date): Promise<SavedAssignment[]> {
    // role_assignment_locations go with them (ON DELETE CASCADE).
    await this.tx.execute(sql`delete from role_assignments where user_id = ${userId}`);
    const saved: SavedAssignment[] = [];
    for (const { roleId, scope } of next) {
      const id = uuidv7(now.getTime());
      // Composite FKs: a role, user or location of another tenant fails with 23503 (generic 404).
      await this.tx.execute(
        sql`insert into role_assignments (id, tenant_id, user_id, role_id, scope, created_at)
            values (${id}, ${this.tenantId}, ${userId}, ${roleId}, ${scope.type}, ${now})`,
      );
      if (scope.type === 'locations') {
        await this.tx.execute(
          sql`insert into role_assignment_locations (assignment_id, location_id, tenant_id)
              select ${id}, l, ${this.tenantId} from unnest(${sql.param([...scope.locationIds])}::uuid[]) as l`,
        );
      }
      const savedScope: Scope = scope.type === 'tenant' ? { type: 'tenant' } : { type: 'locations', locationIds: [...scope.locationIds] };
      saved.push({ id, roleId, scope: savedScope });
    }
    return saved;
  }

  async ownerCandidates(): Promise<OwnerCandidate[]> {
    const found = await rows<{ roleId: string; status: 'active' | 'disabled' }>(
      this.tx,
      sql`select a.role_id as "roleId", u.status
          from role_assignments a
          join roles ro on ro.id = a.role_id and ro.tenant_id = a.tenant_id
          join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
          where ro.is_system and ro.key = 'owner' and a.scope = 'tenant'`,
    );
    return found.map(({ roleId, status }) => ({
      status,
      assignments: [{ role: { id: roleId, key: 'owner', isSystem: true, permissions: SYSTEM_ROLES.owner.permissions }, scope: { type: 'tenant' } }],
    }));
  }

  async countByRole(roleId: string): Promise<number> {
    const [row] = await rows<{ n: number }>(
      this.tx,
      sql`select count(*)::int as n
          from role_assignments a
          where a.role_id = ${roleId}
            and (
              a.scope = 'tenant'
              or exists (
                select 1 from role_assignment_locations l
                join locations loc on loc.id = l.location_id and loc.tenant_id = l.tenant_id
                where l.assignment_id = a.id and l.tenant_id = a.tenant_id and loc.archived_at is null
              )
            )`,
    );
    return row?.n ?? 0;
  }

  async hasLocationScopedByRole(roleId: string): Promise<boolean> {
    const [row] = await rows<{ found: boolean }>(
      this.tx,
      sql`select exists (
            select 1 from role_assignments a
            where a.role_id = ${roleId} and a.scope = 'locations'
              and exists (
                select 1 from role_assignment_locations l
                join locations loc on loc.id = l.location_id and loc.tenant_id = l.tenant_id
                where l.assignment_id = a.id and l.tenant_id = a.tenant_id and loc.archived_at is null
              )
          ) as found`,
    );
    return row?.found ?? false;
  }
}
