import { PERMISSIONS, type Paginated, type Permission, type SystemRoleKey } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { RoleRecord, RoleRepository } from '../../domain/role-ports';

// Permissions in catalog order, so responses are stable.
const SELECT = sql`select r.id, r.key, r.name, r.is_system as "isSystem", r.created_at as "createdAt",
                          coalesce((select json_agg(p.permission) from role_permissions p
                                    where p.role_id = r.id and p.tenant_id = r.tenant_id), '[]'::json) as permissions
                   from roles r`;

interface Row {
  id: string;
  key: SystemRoleKey | null;
  name: string;
  isSystem: boolean;
  createdAt: Date | string;
  permissions: string[];
}

const toRecord = (row: Row): RoleRecord => ({
  ...row,
  createdAt: toDate(row.createdAt),
  permissions: PERMISSIONS.filter((p) => row.permissions.includes(p)),
});

export class RolesRepository implements RoleRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async list(page: PageRequest): Promise<Paginated<RoleRecord>> {
    const after = decodeCursor(page.cursor, ['uuid'])?.[0] ?? null;
    const found = await rows<Row>(this.tx, sql`${SELECT} where (${after}::uuid is null or r.id > ${after}::uuid) order by r.id limit ${page.limit + 1}`);
    return toPage(found.map(toRecord), page.limit, (last) => [last.id]);
  }

  async findById(id: string): Promise<RoleRecord | null> {
    const [row] = await rows<Row>(this.tx, sql`${SELECT} where r.id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<RoleRecord[]> {
    if (ids.length === 0) return [];
    return (await rows<Row>(this.tx, sql`${SELECT} where r.id = any(${sql.param([...ids])}::uuid[])`)).map(toRecord);
  }

  async create(input: { name: string; permissions: readonly Permission[]; now: Date }): Promise<RoleRecord> {
    const id = uuidv7(input.now.getTime());
    await this.tx.execute(
      sql`insert into roles (id, tenant_id, name, is_system, created_at) values (${id}, ${this.tenantId}, ${input.name}, false, ${input.now})`,
    );
    await this.insertPermissions(id, input.permissions);
    return (await this.findById(id))!;
  }

  async update(id: string, changes: { name?: string; permissions?: readonly Permission[] }): Promise<RoleRecord> {
    if (changes.name !== undefined) await this.tx.execute(sql`update roles set name = ${changes.name} where id = ${id}`);
    if (changes.permissions !== undefined) {
      await this.tx.execute(sql`delete from role_permissions where role_id = ${id}`);
      await this.insertPermissions(id, changes.permissions);
    }
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    await this.tx.execute(sql`delete from roles where id = ${id}`);
  }

  private async insertPermissions(roleId: string, permissions: readonly Permission[]): Promise<void> {
    if (permissions.length === 0) return;
    await this.tx.execute(
      sql`insert into role_permissions (role_id, permission, tenant_id)
          select ${roleId}, p, ${this.tenantId} from unnest(${sql.param([...permissions])}::text[]) as p`,
    );
  }
}
