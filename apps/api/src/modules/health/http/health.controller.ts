import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import { CheckHealth } from '../application/check-health.use-case';
import { HealthResponseDto } from './health.dto';

/**
 * Driving adapter: translates HTTP into a use-case call. Controllers hold no
 * business logic; `@ZodResponse` validates the output against the contract and
 * documents it in OpenAPI.
 *
 * Public on purpose (docs/20: only `/health` and `/auth/*` skip the guard).
 */
@ApiTags('health')
@ApiErrorResponse()
@Controller('health')
export class HealthController {
  constructor(private readonly checkHealth: CheckHealth) {}

  @Get()
  @ApiOperation({
    operationId: 'getHealth',
    summary: 'API and database health',
    description: 'Always 200 while the process is up; `status` is `error` when a dependency is down.',
  })
  @ZodResponse({ status: 200, description: 'Health report', type: HealthResponseDto })
  getHealth() {
    return this.checkHealth.execute();
  }
}
