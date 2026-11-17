import { Module } from '@nestjs/common';

import type { Database } from '../../infrastructure/db/database';
import { DATABASE } from '../../infrastructure/db/database.tokens';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { CLOCK } from '../iam/iam.tokens';
import { ArchiveProduct, CreateProduct, GetProduct, ListProducts, SetLocationPrice, UpdateProduct } from './application/catalog.use-cases';
import { CATALOG_UNIT_OF_WORK } from './catalog.tokens';
import type { CatalogUnitOfWork } from './domain/catalog-ports';
import { CatalogController } from './http/catalog.controller';
import { DrizzleCatalogUnitOfWork } from './infrastructure/drizzle-catalog-unit-of-work';

/** Products and per-location prices (SP3·T4). Persistence goes through its own unit of work (RLS). */
@Module({
  imports: [IamModule],
  controllers: [CatalogController],
  providers: [
    { provide: CATALOG_UNIT_OF_WORK, inject: [DATABASE], useFactory: (db: Database) => new DrizzleCatalogUnitOfWork(db) },
    { provide: ListProducts, inject: [CATALOG_UNIT_OF_WORK], useFactory: (uow: CatalogUnitOfWork) => new ListProducts(uow) },
    { provide: GetProduct, inject: [CATALOG_UNIT_OF_WORK], useFactory: (uow: CatalogUnitOfWork) => new GetProduct(uow) },
    { provide: CreateProduct, inject: [CATALOG_UNIT_OF_WORK, CLOCK], useFactory: (uow: CatalogUnitOfWork, clock: Clock) => new CreateProduct(uow, clock) },
    { provide: UpdateProduct, inject: [CATALOG_UNIT_OF_WORK, CLOCK], useFactory: (uow: CatalogUnitOfWork, clock: Clock) => new UpdateProduct(uow, clock) },
    { provide: ArchiveProduct, inject: [CATALOG_UNIT_OF_WORK, CLOCK], useFactory: (uow: CatalogUnitOfWork, clock: Clock) => new ArchiveProduct(uow, clock) },
    { provide: SetLocationPrice, inject: [CATALOG_UNIT_OF_WORK, CLOCK], useFactory: (uow: CatalogUnitOfWork, clock: Clock) => new SetLocationPrice(uow, clock) },
  ],
})
export class CatalogModule {}
