import { Module } from '@nestjs/common';

import type { Database } from '../../infrastructure/db/database';
import { DATABASE } from '../../infrastructure/db/database.tokens';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { CLOCK } from '../iam/iam.tokens';
import { RecordSale } from './application/record-sale.use-case';
import type { SalesUnitOfWork } from './domain/sales-ports';
import { DrizzleSalesUnitOfWork } from './infrastructure/drizzle-sales-unit-of-work';
import { SALES_UNIT_OF_WORK } from './sales.tokens';

/**
 * Sales (SP4, ADR 0007): `RecordSale` only, with no controller. The demo seed uses it in
 * SP4; SP5 adds the HTTP route (the mobile op-log push) without changing the use case.
 */
@Module({
  imports: [IamModule],
  providers: [
    { provide: SALES_UNIT_OF_WORK, inject: [DATABASE], useFactory: (db: Database) => new DrizzleSalesUnitOfWork(db) },
    { provide: RecordSale, inject: [SALES_UNIT_OF_WORK, CLOCK], useFactory: (uow: SalesUnitOfWork, clock: Clock) => new RecordSale(uow, clock) },
  ],
  exports: [RecordSale],
})
export class SalesModule {}
