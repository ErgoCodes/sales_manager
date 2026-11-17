import type { Paginated } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { DeviceAdminRepository, DeviceRecord } from '../../domain/device-admin-ports';

const COLUMNS = sql`id, user_id as "userId", label, platform, created_at as "createdAt", last_seen_at as "lastSeenAt", revoked_at as "revokedAt"`;

type Row = Omit<DeviceRecord, 'createdAt' | 'lastSeenAt' | 'revokedAt'> & {
  createdAt: Date | string;
  lastSeenAt: Date | string | null;
  revokedAt: Date | string | null;
};
const toRecord = (row: Row): DeviceRecord => ({
  ...row,
  createdAt: toDate(row.createdAt),
  lastSeenAt: toDate(row.lastSeenAt),
  revokedAt: toDate(row.revokedAt),
});

export class DeviceAdminRepositoryImpl implements DeviceAdminRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async listByUser(userId: string, page: PageRequest): Promise<Paginated<DeviceRecord>> {
    const before = decodeCursor(page.cursor, ['uuid'])?.[0] ?? null;
    const found = await rows<Row>(
      this.tx,
      sql`select ${COLUMNS} from devices where user_id = ${userId} and (${before}::uuid is null or id < ${before}::uuid)
          order by id desc limit ${page.limit + 1}`,
    );
    return toPage(found.map(toRecord), page.limit, (last) => [last.id]);
  }

  async findById(id: string): Promise<DeviceRecord | null> {
    const [row] = await rows<Row>(this.tx, sql`select ${COLUMNS} from devices where id = ${id}`);
    return row ? toRecord(row) : null;
  }

  async revoke(id: string, now: Date): Promise<DeviceRecord | null> {
    const [row] = await rows<Row>(this.tx, sql`update devices set revoked_at = coalesce(revoked_at, ${now}) where id = ${id} returning ${COLUMNS}`);
    return row ? toRecord(row) : null;
  }
}
