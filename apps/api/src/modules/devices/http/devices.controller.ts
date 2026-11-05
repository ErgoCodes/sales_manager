import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Device, ListDevicesQuery, PaginatedDevices } from '@monaco/contracts';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto } from '../../iam/http/admin.dto';
import { ClientIp, CurrentActor } from '../../iam/http/auth.decorators';
import { rethrowHttp } from '../../iam/http/auth-http-errors';
import { ListDevices, RevokeDevice } from '../application/devices.use-cases';

class DeviceDto extends createZodDto(Device) {}
class PaginatedDevicesDto extends createZodDto(PaginatedDevices) {}
class ListDevicesQueryDto extends createZodDto(ListDevicesQuery) {}

@ApiTags('devices')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly listDevices: ListDevices,
    private readonly revokeDevice: RevokeDevice,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listDevices',
    summary: "The caller's devices, or another user's (devices:manage)",
    description: 'A Manager only reaches users entirely inside its locations; only an Owner reaches an Owner.',
  })
  @ZodResponse({ status: 200, description: 'A page of devices, newest first', type: PaginatedDevicesDto })
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: ListDevicesQueryDto) {
    return this.listDevices.execute(actor, query).catch(rethrowHttp);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'revokeDevice', summary: 'Revoke a device and its sessions (own, or devices:manage)' })
  @ZodResponse({ status: 200, description: 'The revoked device', type: DeviceDto })
  revoke(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto) {
    return this.revokeDevice.execute({ actor, ip }, params.id).catch(rethrowHttp);
  }
}
