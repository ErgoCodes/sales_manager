import type { Paginated } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { PageRequest } from '../../../iam/domain/admin-ports';
import { decodeCursor, toPage } from '../../../iam/infrastructure/pagination';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { LocationRecord, LocationRepository } from '../../domain/location-ports';

const COLUMNS = sql`id, name, code, archived_at as "archivedAt", created_at as "createdAt"`;

type Row = Omit<LocationRecord, 'archivedAt' | 'createdAt'> & { archivedAt: Date | string | null; createdAt: Date | string };
const toRecord = (row: Row): LocationRecord => ({ ...row, archivedAt: toDate(row.archivedAt), createdAt: toDate(row.createdAt) });

export class LocationsRepository implements LocationRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async list(page: PageRequest & { readonly onlyIds?: readonly string[] }): Promise<Paginated<LocationRecord>> {
    const after = decodeCursor(page.cursor, ['uuid']);
    const found = await rows<Row>(
      this.tx,
      sql`select ${COLUMNS} from locations
          where (${after?.[0] ?? null}::uuid is null or id > ${after?.[0] ?? null}::uuid)
            and (${page.onlyIds === undefined} or id = any(${sql.param([...(page.onlyIds ?? [])])}::uuid[]))
          order by id limit ${page.limit + 1}`,
    );
    return toPage(found.map(toRecord), page.limit, (last) => [last.id]);
  }

  async create(input: { name: string; code: string; now: Date }): Promise<LocationRecord> {
    const [row] = await rows<Row>(
      this.tx,
      sql`insert into locations (id, tenant_id, name, code, created_at)
          values (${uuidv7(input.now.getTime())}, ${this.tenantId}, ${input.name}, ${input.code}, ${input.now})
          returning ${COLUMNS}`,
    );
    return toRecord(row!);
  }

  async update(id: string, changes: { name?: string; code?: string }): Promise<LocationRecord | null> {
    const [row] = await rows<Row>(
      this.tx,
      sql`update locations set name = coalesce(${changes.name ?? null}, name), code = coalesce(${changes.code ?? null}, code)
          where id = ${id} returning ${COLUMNS}`,
    );
    return row ? toRecord(row) : null;
  }

  async archive(id: string, now: Date): Promise<LocationRecord | null> {
    const [row] = await rows<Row>(
      this.tx,
      sql`update locations set archived_at = coalesce(archived_at, ${now}) where id = ${id} returning ${COLUMNS}`,
    );
    return row ? toRecord(row) : null;
  }

  async findActiveIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const found = await rows<{ id: string }>(
      this.tx,
      sql`select id from locations where id = any(${sql.param([...ids])}::uuid[]) and archived_at is null`,
    );
    return found.map((row) => row.id);
  }
}
