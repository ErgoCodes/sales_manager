import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import type { Database } from '../../infrastructure/db/database';
import { DATABASE } from '../../infrastructure/db/database.tokens';
import { IamModule } from '../iam/iam.module';
import { GetDailySeries, GetInventoryHealth, GetReportSummary, GetSummaryByLocation, GetTopProducts } from './application/reports.use-cases';
import type { ReportsUnitOfWork } from './domain/reports-ports';
import { noStore } from './http/no-store.middleware';
import { ReportsController } from './http/reports.controller';
import { DrizzleReportsUnitOfWork } from './infrastructure/drizzle-reports-unit-of-work';
import { REPORTS_UNIT_OF_WORK } from './reports.tokens';

const USE_CASES = [GetReportSummary, GetDailySeries, GetTopProducts, GetSummaryByLocation, GetInventoryHealth] as const;

/** Reports (SP4 · T6): live aggregates over sales and the ledger, authorized per location (ADR 0007). */
@Module({
  imports: [IamModule],
  controllers: [ReportsController],
  providers: [
    { provide: REPORTS_UNIT_OF_WORK, inject: [DATABASE], useFactory: (db: Database) => new DrizzleReportsUnitOfWork(db) },
    ...USE_CASES.map((UseCase) => ({ provide: UseCase, inject: [REPORTS_UNIT_OF_WORK], useFactory: (uow: ReportsUnitOfWork) => new UseCase(uow) })),
  ],
})
export class ReportsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStore).forRoutes(ReportsController);
  }
}
