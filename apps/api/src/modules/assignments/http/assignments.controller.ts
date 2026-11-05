import { Body, Controller, Param, Put } from '@nestjs/common';
import { ReplaceAssignmentsRequest, ReplaceAssignmentsResponse } from '@monaco/contracts';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto } from '../../iam/http/admin.dto';
import { ClientIp, CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import { rethrowHttp } from '../../iam/http/auth-http-errors';
import { ReplaceAssignments } from '../application/replace-assignments.use-case';

class ReplaceAssignmentsRequestDto extends createZodDto(ReplaceAssignmentsRequest) {}
class ReplaceAssignmentsResponseDto extends createZodDto(ReplaceAssignmentsResponse) {}

@ApiTags('users')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller('users')
export class AssignmentsController {
  constructor(private readonly replaceAssignments: ReplaceAssignments) {}

  @Put(':id/assignments')
  // Coarse check only (one permission per route); the use case authorizes both.
  @RequirePermission('users:manage')
  @ApiOperation({
    operationId: 'replaceAssignments',
    summary: "Replace a user's role assignments atomically (users:manage + roles:manage)",
    description:
      'Never one\'s own (403). Owner only by an Owner; every added or removed assignment must be within the caller\'s permissions and scope (403). Administrative permissions only tenant-wide (422). 409 if no active Owner would remain.',
  })
  @ZodResponse({ status: 200, description: 'The new assignments', type: ReplaceAssignmentsResponseDto })
  replace(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto, @Body() body: ReplaceAssignmentsRequestDto) {
    return this.replaceAssignments.execute({ actor, ip }, params.id, body).catch(rethrowHttp);
  }
}
