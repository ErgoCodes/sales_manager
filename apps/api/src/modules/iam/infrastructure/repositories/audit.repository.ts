import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { AuditEntry, AuditLog } from '../../domain/auth-ports';

/** Append-only (monaco_app has INSERT and SELECT only on audit_events). */
export class AuditRepository implements AuditLog {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.tx.execute(
      sql`insert into audit_events (id, tenant_id, actor_user_id, type, target_type, target_id, metadata, ip)
          values (${uuidv7()}, ${this.tenantId}, ${entry.actorUserId}, ${entry.type}, ${entry.targetType ?? null},
                  ${entry.targetId ?? null}, ${JSON.stringify(entry.metadata ?? {})}::jsonb, ${entry.ip}::inet)`,
    );
  }
}
