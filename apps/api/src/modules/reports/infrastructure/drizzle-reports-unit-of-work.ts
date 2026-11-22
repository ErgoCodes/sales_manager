import type { Database } from '../../../infrastructure/db/database';
import { withTenant } from '../../../infrastructure/db/with-tenant';
import type { ReportsReader, ReportsUnitOfWork } from '../domain/reports-ports';
import { ReportsReaderRepository } from './repositories/reports-reader.repository';

/**
 * The only place that builds the reports reader (ADR 0004): on a transaction
 * `withTenant` opened, so every aggregate runs under RLS (ADR 0003) and all the
 * reads of one report see the same now().
 */
export class DrizzleReportsUnitOfWork implements ReportsUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(tenantId: string, work: (reader: ReportsReader) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) => work(new ReportsReaderRepository(tx, tenantId)));
  }
}
