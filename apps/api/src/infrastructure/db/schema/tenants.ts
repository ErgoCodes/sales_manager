import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenantIsolationPolicy, tenantRowPolicy } from './tenancy';
import { createdAt, primaryId } from './types';

/**
 * A business. Created by the CLI as monaco_owner (SP2·T5). Its policy keys on
 * `id` (it is the only table without `tenant_id`, ADR 0003); the app can read
 * its own row and update only `name` (migration 0006), so `time_zone` and
 * `read_only` are set by the owner role only; it cannot insert or delete tenants.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique('tenants_slug_unique'),
    // IANA zone of the business day (SP4 · D3). Validated with TimeZone when written (tenant:create), never on read.
    timeZone: text('time_zone').notNull().default('America/Havana'),
    // Public demo (SP4 · D10): every mutation but login, refresh and logout answers 403 DEMO_READ_ONLY.
    readOnly: boolean('read_only').notNull().default(false),
    createdAt: createdAt(),
  },
  () => [tenantRowPolicy('tenants')],
);

/** Tenant FK shared by every tenant-owned table. */
export const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

/** Point of sale. Archived instead of deleted: SP3 hangs stock and sales off it. */
export const locations = pgTable(
  'locations',
  {
    id: primaryId(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('locations_tenant_id_code_unique').on(t.tenantId, t.code),
    // Target of composite FKs (ADR 0003): a reference must match the tenant.
    unique('locations_id_tenant_id_unique').on(t.id, t.tenantId),
    tenantIsolationPolicy('locations'),
  ],
);
