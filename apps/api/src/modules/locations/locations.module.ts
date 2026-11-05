import { Module } from '@nestjs/common';

import type { AdminUnitOfWork } from '../iam/domain/admin-ports';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { ADMIN_UNIT_OF_WORK, CLOCK } from '../iam/iam.tokens';
import { ArchiveLocation, CreateLocation, ListLocations, UpdateLocation } from './application/locations.use-cases';
import { LocationsController } from './http/locations.controller';

/** Points of sale (SP2·T4). Persistence comes through IAM's admin unit of work (RLS). */
@Module({
  imports: [IamModule],
  controllers: [LocationsController],
  providers: [
    { provide: ListLocations, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new ListLocations(uow) },
    { provide: CreateLocation, inject: [ADMIN_UNIT_OF_WORK, CLOCK], useFactory: (uow: AdminUnitOfWork, clock: Clock) => new CreateLocation(uow, clock) },
    { provide: UpdateLocation, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new UpdateLocation(uow) },
    { provide: ArchiveLocation, inject: [ADMIN_UNIT_OF_WORK, CLOCK], useFactory: (uow: AdminUnitOfWork, clock: Clock) => new ArchiveLocation(uow, clock) },
  ],
})
export class LocationsModule {}
