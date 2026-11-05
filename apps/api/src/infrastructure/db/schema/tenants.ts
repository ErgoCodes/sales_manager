import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenantIsolationPolicy, tenantRowPolicy } from './tenancy';
import { createdAt, primaryId } from './types';

/**
 * A business. Created by the CLI as monaco_owner (SP2·T5). Its policy keys on
 * `id` (it is the only table without `tenant_id`, ADR 0003); the app can read
 * and update its own row but not insert or delete tenants.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique('tenants_slug_unique'),
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
