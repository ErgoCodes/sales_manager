import { sql } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/database';
import { withTenant } from '../../../infrastructure/db/with-tenant';
import type { ReportsReader, ReportsUnitOfWork } from '../domain/reports-ports';
import { ReportsReaderRepository } from './repositories/reports-reader.repository';

/**
 * `random_page_cost` of the reports transaction only (ADR 0007, "Resultados
 * medidos"). With the default of 4 (a spinning disk), a 30-day window holding a
 * third of `sale_lines` costs the same as an index-only scan of
 * `sale_lines_kpi_idx` and as a Seq Scan, so the planner flips between them from
 * one ANALYZE to the next. 1.1 is the usual value for SSD storage and keeps the
 * index-only plan.
 */
export const REPORTS_RANDOM_PAGE_COST = '1.1';

/**
 * The only place that builds the reports reader (ADR 0004): on a transaction
 * `withTenant` opened, so every aggregate runs under RLS (ADR 0003) and all the
 * reads of one report see the same now().
 */
export class DrizzleReportsUnitOfWork implements ReportsUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (reader: ReportsReader) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx.execute(sql.raw(`set local random_page_cost = ${REPORTS_RANDOM_PAGE_COST}`));
      return work(new ReportsReaderRepository(tx, tenantId));
    });
  }
}
