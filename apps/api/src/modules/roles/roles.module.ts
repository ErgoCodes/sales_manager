import { Module } from '@nestjs/common';

import type { AdminUnitOfWork } from '../iam/domain/admin-ports';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { ADMIN_UNIT_OF_WORK, CLOCK } from '../iam/iam.tokens';
import { CreateRole, DeleteRole, ListRoles, UpdateRole } from './application/roles.use-cases';
import { RolesController } from './http/roles.controller';

/** Roles of a tenant (SP2·T4). */
@Module({
  imports: [IamModule],
  controllers: [RolesController],
  providers: [
    { provide: ListRoles, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new ListRoles(uow) },
    { provide: CreateRole, inject: [ADMIN_UNIT_OF_WORK, CLOCK], useFactory: (uow: AdminUnitOfWork, clock: Clock) => new CreateRole(uow, clock) },
    { provide: UpdateRole, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new UpdateRole(uow) },
    { provide: DeleteRole, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new DeleteRole(uow) },
  ],
})
export class RolesModule {}
