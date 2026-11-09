import type { AuditEventType, Paginated } from '@monaco/contracts';

import type { PageRequest } from '../../iam/domain/admin-ports';

export interface AuditEventRecord {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly type: AuditEventType;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly ip: string | null;
  readonly createdAt: Date;
}

export interface AuditEventReader {
  /** Newest first (`created_at desc, id desc`). */
  list(page: PageRequest): Promise<Paginated<AuditEventRecord>>;
}
