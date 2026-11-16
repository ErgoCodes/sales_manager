import type { Paginated } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { ManagedUser, NewUser, UserAdminRepository } from '../../domain/user-admin-ports';

// Never password_hash: it does not leave the authentication adapters.
const COLUMNS = sql`id, email, display_name as "displayName", status, must_change_password as "mustChangePassword", created_at as "createdAt"`;

type Row = Omit<ManagedUser, 'createdAt'> & { createdAt: Date | string };
const toRecord = (row: Row): ManagedUser => ({ ...row, createdAt: toDate(row.createdAt) });
const first = (found: Row[]): ManagedUser | null => (found[0] ? toRecord(found[0]) : null);

export class UserAdminRepositoryImpl implements UserAdminRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async list(page: PageRequest): Promise<Paginated<ManagedUser>> {
    const after = decodeCursor(page.cursor, ['uuid'])?.[0] ?? null;
    const found = await rows<Row>(
      this.tx,
      sql`select ${COLUMNS} from users where (${after}::uuid is null or id > ${after}::uuid) order by id limit ${page.limit + 1}`,
    );
    return toPage(found.map(toRecord), page.limit, (last) => [last.id]);
  }

  async findById(id: string): Promise<ManagedUser | null> {
    return first(await rows<Row>(this.tx, sql`select ${COLUMNS} from users where id = ${id}`));
  }

  /**
   * The email is unique across tenants and RLS hides the other tenants' users,
   * so the conflict is detected by the unique index itself (`on conflict do
   * nothing`): no row back means the email exists somewhere. Nothing aborts the
   * transaction, so the caller can still write its audit event.
   */
  async create(user: NewUser): Promise<ManagedUser | null> {
    return first(
      await rows<Row>(
        this.tx,
        sql`insert into users (id, tenant_id, email, display_name, password_hash, must_change_password, password_expires_at, created_at)
            values (${uuidv7(user.now.getTime())}, ${this.tenantId}, ${user.email}, ${user.displayName}, ${user.passwordHash},
                    true, ${user.passwordExpiresAt}, ${user.now})
            on conflict (email) do nothing
            returning ${COLUMNS}`,
      ),
    );
  }

  async updateDisplayName(id: string, displayName: string): Promise<ManagedUser | null> {
    return first(await rows<Row>(this.tx, sql`update users set display_name = ${displayName} where id = ${id} returning ${COLUMNS}`));
  }

  async disable(id: string): Promise<ManagedUser | null> {
    return first(await rows<Row>(this.tx, sql`update users set status = 'disabled' where id = ${id} returning ${COLUMNS}`));
  }

  async setTemporaryPassword(id: string, passwordHash: string, expiresAt: Date): Promise<void> {
    await this.tx.execute(
      sql`update users set password_hash = ${passwordHash}, must_change_password = true, password_expires_at = ${expiresAt}
          where id = ${id}`,
    );
  }
}
