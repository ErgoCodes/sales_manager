import { Module } from '@nestjs/common';

import type { Database } from '../../infrastructure/db/database';
import { DATABASE } from '../../infrastructure/db/database.tokens';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { CLOCK } from '../iam/iam.tokens';
import { GetInventoryDocument, GetLocationStock, GetProductStock, ListLocationMovements } from './application/inventory-reads.use-cases';
import { RecordAdjustment, RecordEntry, RecordExit, RecordTransfer, ReverseDocument } from './application/inventory.use-cases';
import type { InventoryUnitOfWork } from './domain/inventory-ports';
import { InventoryController } from './http/inventory.controller';
import { InventoryReadsController } from './http/inventory-reads.controller';
import { INVENTORY_UNIT_OF_WORK } from './inventory.tokens';
import { DrizzleInventoryUnitOfWork } from './infrastructure/drizzle-inventory-unit-of-work';

/** Inventory ledger (SP3): writes under the ADR 0006 locking script (T5a), transfers and reversals (T6) and reads with cost visibility and masking (T5b). */
@Module({
  imports: [IamModule],
  controllers: [InventoryController, InventoryReadsController],
  providers: [
    { provide: INVENTORY_UNIT_OF_WORK, inject: [DATABASE], useFactory: (db: Database) => new DrizzleInventoryUnitOfWork(db) },
    { provide: RecordEntry, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordEntry(uow, clock) },
    { provide: RecordExit, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordExit(uow, clock) },
    { provide: RecordAdjustment, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordAdjustment(uow, clock) },
    { provide: RecordTransfer, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new RecordTransfer(uow, clock) },
    { provide: ReverseDocument, inject: [INVENTORY_UNIT_OF_WORK, CLOCK], useFactory: (uow: InventoryUnitOfWork, clock: Clock) => new ReverseDocument(uow, clock) },
    { provide: GetLocationStock, inject: [INVENTORY_UNIT_OF_WORK], useFactory: (uow: InventoryUnitOfWork) => new GetLocationStock(uow) },
    { provide: GetProductStock, inject: [INVENTORY_UNIT_OF_WORK], useFactory: (uow: InventoryUnitOfWork) => new GetProductStock(uow) },
    { provide: ListLocationMovements, inject: [INVENTORY_UNIT_OF_WORK], useFactory: (uow: InventoryUnitOfWork) => new ListLocationMovements(uow) },
    { provide: GetInventoryDocument, inject: [INVENTORY_UNIT_OF_WORK], useFactory: (uow: InventoryUnitOfWork) => new GetInventoryDocument(uow) },
  ],
})
export class InventoryModule {}
