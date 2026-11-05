import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateLocationRequest, Location, PaginatedLocations, UpdateLocationRequest } from '@monaco/contracts';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto, PaginationQueryDto } from '../../iam/http/admin.dto';
import { ClientIp, CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import { rethrowHttp } from '../../iam/http/auth-http-errors';
import { ArchiveLocation, CreateLocation, ListLocations, UpdateLocation } from '../application/locations.use-cases';

class LocationDto extends createZodDto(Location) {}
class PaginatedLocationsDto extends createZodDto(PaginatedLocations) {}
class CreateLocationRequestDto extends createZodDto(CreateLocationRequest) {}
class UpdateLocationRequestDto extends createZodDto(UpdateLocationRequest) {}

@ApiTags('locations')
@ApiErrorResponse()
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly listLocations: ListLocations,
    private readonly createLocation: CreateLocation,
    private readonly updateLocation: UpdateLocation,
    private readonly archiveLocation: ArchiveLocation,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listLocations', summary: 'Locations the caller can see (all of them with any tenant-wide permission)' })
  @ZodResponse({ status: 200, description: 'A page of locations, oldest first', type: PaginatedLocationsDto })
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: PaginationQueryDto) {
    return this.listLocations.execute(actor, query).catch(rethrowHttp);
  }

  @Post()
  @RequirePermission('locations:manage')
  @ApiOperation({ operationId: 'createLocation', summary: 'Create a location (locations:manage)' })
  @ZodResponse({ status: 201, description: 'The new location', type: LocationDto })
  create(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Body() body: CreateLocationRequestDto) {
    return this.createLocation.execute({ actor, ip }, body).catch(rethrowHttp);
  }

  @Patch(':id')
  @RequirePermission('locations:manage')
  @ApiOperation({ operationId: 'updateLocation', summary: 'Rename a location or change its code (locations:manage)' })
  @ZodResponse({ status: 200, description: 'The updated location', type: LocationDto })
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @ClientIp() ip: string | null,
    @Param() params: IdParamsDto,
    @Body() body: UpdateLocationRequestDto,
  ) {
    return this.updateLocation.execute({ actor, ip }, params.id, body).catch(rethrowHttp);
  }

  @Post(':id/archive')
  @RequirePermission('locations:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'archiveLocation', summary: 'Archive a location (locations:manage); idempotent' })
  @ZodResponse({ status: 200, description: 'The archived location', type: LocationDto })
  archive(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto) {
    return this.archiveLocation.execute({ actor, ip }, params.id).catch(rethrowHttp);
  }
}
