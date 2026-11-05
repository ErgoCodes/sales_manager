import { Module } from '@nestjs/common';

import type { AdminUnitOfWork } from '../iam/domain/admin-ports';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { ADMIN_UNIT_OF_WORK, CLOCK } from '../iam/iam.tokens';
import { ListDevices, RevokeDevice } from './application/devices.use-cases';
import { DevicesController } from './http/devices.controller';

/** Devices (one per login place) and their revocation (SP2·T4). */
@Module({
  imports: [IamModule],
  controllers: [DevicesController],
  providers: [
    { provide: ListDevices, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new ListDevices(uow) },
    { provide: RevokeDevice, inject: [ADMIN_UNIT_OF_WORK, CLOCK], useFactory: (uow: AdminUnitOfWork, clock: Clock) => new RevokeDevice(uow, clock) },
  ],
})
export class DevicesModule {}
