import { Module } from '@nestjs/common';

import type { AdminUnitOfWork } from '../iam/domain/admin-ports';
import { IamModule } from '../iam/iam.module';
import { ADMIN_UNIT_OF_WORK } from '../iam/iam.tokens';
import { ListAuditEvents } from './application/list-audit-events.use-case';
import { AuditEventsController } from './http/audit-events.controller';

/** Read side of the audit log (SP2·T4); every module writes through `AuditLog.record`. */
@Module({
  imports: [IamModule],
  controllers: [AuditEventsController],
  providers: [{ provide: ListAuditEvents, inject: [ADMIN_UNIT_OF_WORK], useFactory: (uow: AdminUnitOfWork) => new ListAuditEvents(uow) }],
})
export class AuditModule {}
