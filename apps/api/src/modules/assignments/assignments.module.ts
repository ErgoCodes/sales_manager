import { Module } from '@nestjs/common';

import type { AdminUnitOfWork } from '../iam/domain/admin-ports';
import type { Clock } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { ADMIN_UNIT_OF_WORK, CLOCK } from '../iam/iam.tokens';
import { ReplaceAssignments } from './application/replace-assignments.use-case';
import { AssignmentsController } from './http/assignments.controller';

/** Role assignments of a user, with their scope (SP2·T4). */
@Module({
  imports: [IamModule],
  controllers: [AssignmentsController],
  providers: [
    {
      provide: ReplaceAssignments,
      inject: [ADMIN_UNIT_OF_WORK, CLOCK],
      useFactory: (uow: AdminUnitOfWork, clock: Clock) => new ReplaceAssignments(uow, clock),
    },
  ],
})
export class AssignmentsModule {}
