import { Controller, Get, Query } from '@nestjs/common';
import { PaginatedAuditEvents } from '@monaco/contracts';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { PaginationQueryDto } from '../../iam/http/admin.dto';
import { CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import { ListAuditEvents } from '../application/list-audit-events.use-case';

class PaginatedAuditEventsDto extends createZodDto(PaginatedAuditEvents) {}

@ApiTags('audit')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller('audit-events')
export class AuditEventsController {
  constructor(private readonly listAuditEvents: ListAuditEvents) {}

  @Get()
  @RequirePermission('audit:view')
  @ApiOperation({ operationId: 'listAuditEvents', summary: 'Security log of the tenant, newest first (audit:view)' })
  @ZodResponse({ status: 200, description: 'A page of audit events', type: PaginatedAuditEventsDto })
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: PaginationQueryDto) {
    return this.listAuditEvents.execute(actor, query);
  }
}
