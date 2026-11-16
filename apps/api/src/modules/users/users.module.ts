import { Module } from '@nestjs/common';

import type { AdminUnitOfWork } from '../iam/domain/admin-ports';
import type { Clock, PasswordHasher } from '../iam/domain/auth-ports';
import { IamModule } from '../iam/iam.module';
import { ADMIN_UNIT_OF_WORK, CLOCK, PASSWORD_HASHER } from '../iam/iam.tokens';
import { CreateUser, DisableUser, GetUser, ListUsers, ResetUserPassword, UpdateUser } from './application/users.use-cases';
import type { TemporaryPasswordGenerator } from './domain/user-admin-ports';
import { UsersController } from './http/users.controller';
import { RandomTemporaryPasswordGenerator } from './infrastructure/random-temporary-password';
import { TEMPORARY_PASSWORDS } from './users.tokens';

/** Users of a tenant (SP2·T4). */
@Module({
  imports: [IamModule],
  controllers: [UsersController],
  providers: [
    { provide: TEMPORARY_PASSWORDS, useFactory: () => new RandomTemporaryPasswordGenerator() },
    { provide: ListUsers, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new ListUsers(uow) },
    { provide: GetUser, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new GetUser(uow) },
    {
      provide: CreateUser,
      inject: [ADMIN_UNIT_OF_WORK, PASSWORD_HASHER, TEMPORARY_PASSWORDS, CLOCK],
      useFactory: (uow: AdminUnitOfWork, hasher: PasswordHasher, passwords: TemporaryPasswordGenerator, clock: Clock) =>
        new CreateUser(uow, hasher, passwords, clock),
    },
    { provide: UpdateUser, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new UpdateUser(uow) },
    { provide: DisableUser, inject: [ADMIN_UNIT_OF_WORK, CLOCK], useFactory: (uow: AdminUnitOfWork, clock: Clock) => new DisableUser(uow, clock) },
    {
      provide: ResetUserPassword,
      inject: [ADMIN_UNIT_OF_WORK, PASSWORD_HASHER, TEMPORARY_PASSWORDS, CLOCK],
      useFactory: (uow: AdminUnitOfWork, hasher: PasswordHasher, passwords: TemporaryPasswordGenerator, clock: Clock) =>
        new ResetUserPassword(uow, hasher, passwords, clock),
    },
  ],
})
export class UsersModule {}
