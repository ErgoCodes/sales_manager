import { Module } from '@nestjs/common';

import type { Database } from '../../infrastructure/db/database';
import { DATABASE } from '../../infrastructure/db/database.tokens';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { CLOCK } from '../iam/iam.tokens';
import { RecordAdjustment, RecordEntry, RecordExit } from './application/inventory.use-cases';
import type { InventoryUnitOfWork } from './domain/inventory-ports';
import { InventoryController } from './http/inventory.controller';
import { INVENTORY_UNIT_OF_WORK } from './inventory.tokens';
import { DrizzleInventoryUnitOfWork } from './infrastructure/drizzle-inventory-unit-of-work';

/** Inventory ledger writes (SP3·T5a): entries, exits and adjustments under the ADR 0006 locking script. */
@Module({
  imports: [IamModule],
  controllers: [InventoryController],
  providers: [
    { provide: INVENTORY_UNIT_OF_WORK, inject: [DATABASE], useFactory: (db: Database) => new DrizzleInventoryUnitOfWork(db) },
    { provide: RecordEntry, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordEntry(uow, clock) },
    { provide: RecordExit, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordExit(uow, clock) },
    { provide: RecordAdjustment, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordAdjustment(uow, clock) },
  ],
})
export class InventoryModule {}
