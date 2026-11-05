import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenantIsolationPolicy } from './tenancy';

/**
 * Test table for the tenancy convention (SP1). It has no business meaning;
 * the integration tests (SP1·T5) use it to prove RLS isolates tenants.
 */
export const tenancyProbe = pgTable(
  '_tenancy_probe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('_tenancy_probe_tenant_id_idx').on(table.tenantId), tenantIsolationPolicy('_tenancy_probe')],
);
