import type { AuditEventType, Paginated } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { AuditEventReader, AuditEventRecord } from '../../domain/audit-ports';

type Row = Omit<AuditEventRecord, 'createdAt' | 'type'> & { type: AuditEventType; createdAt: Date | string; cursorAt: string };

/** Read side of the append-only audit log, newest first, on the (tenant_id, created_at desc, id desc) index. */
export class AuditEventsRepository implements AuditEventReader {
  constructor(private readonly tx: TenantTransaction) {}

  async list(page: PageRequest): Promise<Paginated<AuditEventRecord>> {
    const [at = null, id = null] = decodeCursor(page.cursor, ['timestamp', 'uuid']) ?? [];
    // `cursorAt` keeps the microseconds of created_at (a JS Date would round them away).
    const found = await rows<Row>(
      this.tx,
      sql`select id, actor_user_id as "actorUserId", type, target_type as "targetType", target_id as "targetId",
                 metadata, host(ip) as ip, created_at as "createdAt",
                 to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt"
          from audit_events
          where (${at}::timestamptz is null or (created_at, id) < (${at}::timestamptz, ${id}::uuid))
          order by created_at desc, id desc limit ${page.limit + 1}`,
    );
    const result = toPage(found, page.limit, (last) => [last.cursorAt, last.id]);
    return {
      items: result.items.map(({ cursorAt: _cursorAt, ...row }) => ({ ...row, createdAt: toDate(row.createdAt) })),
      nextCursor: result.nextCursor,
    };
  }
}
