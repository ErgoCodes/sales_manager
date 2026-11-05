import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import { GetMe } from '../application/get-me.use-case';
import type { AuthenticatedActor } from '../domain/actor';
import { AllowPendingPasswordChange, CurrentActor } from './auth.decorators';
import { MeResponseDto } from './auth.dto';
import { rethrowHttp } from './auth-http-errors';

@ApiTags('auth')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly getMe: GetMe) {}

  @Get()
  @AllowPendingPasswordChange()
  @ApiOperation({ operationId: 'getMe', summary: 'Current user, tenant and effective permissions' })
  @ZodResponse({ status: 200, description: 'The authenticated user', type: MeResponseDto })
  get(@CurrentActor() actor: AuthenticatedActor) {
    return this.getMe.execute(actor).catch(rethrowHttp);
  }
}
