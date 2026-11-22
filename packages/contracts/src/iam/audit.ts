import { z } from 'zod';

import { IsoDateTime, Paginated, Uuid } from '../common';

export const AUDIT_EVENT_TYPES = [
  'login_succeeded',
  'login_failed',
  'refresh_reuse_detected',
  'password_changed',
  'user_created',
  'user_create_conflict',
  'user_updated',
  'user_disabled',
  'user_password_reset',
  'device_revoked',
  'session_revoked',
  'role_created',
  'role_updated',
  'role_deleted',
  'assignments_replaced',
  'location_created',
  'location_updated',
  'location_archived',
  'escalation_denied',
  'product_created',
  'product_updated',
  'product_archived',
  'location_price_set',
  'inventory_entry_recorded',
  'inventory_exit_recorded',
  'inventory_adjustment_recorded',
  'inventory_transfer_recorded',
  'inventory_document_reversed',
  // SP4: RecordSale (no amounts in the metadata).
  'sale_recorded',
] as const;

export const AuditEventType = z.enum(AUDIT_EVENT_TYPES).meta({ id: 'AuditEventType' });
export type AuditEventType = z.infer<typeof AuditEventType>;

export const AuditEvent = z
  .object({
    id: Uuid,
    actorUserId: Uuid.nullable(),
    type: AuditEventType,
    targetType: z.string().nullable(),
    targetId: Uuid.nullable(),
    metadata: z.record(z.string(), z.unknown()).meta({ description: 'Never contains secrets or hashes' }),
    ip: z.string().nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'AuditEvent' });
export type AuditEvent = z.infer<typeof AuditEvent>;

export const PaginatedAuditEvents = Paginated(AuditEvent, 'PaginatedAuditEvents');
