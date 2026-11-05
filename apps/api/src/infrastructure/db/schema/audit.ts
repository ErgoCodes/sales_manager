import { foreignKey, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { users } from './iam';
import { tenantRef } from './tenants';
import { tenantIsolationPolicy } from './tenancy';
import { createdAt, primaryId } from './types';

/**
 * Append-only security log, per tenant. monaco_app may only INSERT and SELECT
 * (grants in migration 0004). Attempts with unknown emails have no tenant and
 * go to the structured log instead.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    // Null for events without a user (e.g. a failed login is attributed to the target).
    actorUserId: uuid('actor_user_id'),
    type: text('type').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: 'audit_events_actor_fk', columns: [t.actorUserId, t.tenantId], foreignColumns: [users.id, users.tenantId] }),
    // Cursor pagination, newest first.
    index('audit_events_tenant_id_created_at_id_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    tenantIsolationPolicy('audit_events'),
  ],
);
