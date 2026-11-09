import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateRoleRequest, PaginatedRoles, Role, UpdateRoleRequest } from '@monaco/contracts';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto, PaginationQueryDto } from '../../iam/http/admin.dto';
import { ClientIp, CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import { CreateRole, DeleteRole, ListRoles, UpdateRole } from '../application/roles.use-cases';

class RoleDto extends createZodDto(Role) {}
class PaginatedRolesDto extends createZodDto(PaginatedRoles) {}
class CreateRoleRequestDto extends createZodDto(CreateRoleRequest) {}
class UpdateRoleRequestDto extends createZodDto(UpdateRoleRequest) {}

@ApiTags('roles')
@ApiErrorResponse()
@ApiBearerAuth()
@RequirePermission('roles:manage')
@Controller('roles')
export class RolesController {
  constructor(
    private readonly listRoles: ListRoles,
    private readonly createRole: CreateRole,
    private readonly updateRole: UpdateRole,
    private readonly deleteRole: DeleteRole,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listRoles', summary: 'Roles of the tenant (roles:manage)' })
  @ZodResponse({ status: 200, description: 'A page of roles', type: PaginatedRolesDto })
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: PaginationQueryDto) {
    return this.listRoles.execute(actor, query);
  }

  @Post()
  @ApiOperation({
    operationId: 'createRole',
    summary: 'Create a custom role (roles:manage)',
    description: 'Only permissions the caller holds tenant-wide; owner-only permissions need an Owner (403 otherwise).',
  })
  @ZodResponse({ status: 201, description: 'The new role', type: RoleDto })
  create(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Body() body: CreateRoleRequestDto) {
    return this.createRole.execute({ actor, ip }, body);
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'updateRole',
    summary: 'Rename a role or replace its permissions (roles:manage)',
    description: 'Affects every holder. The Owner role is immutable (409); admin permissions on a role held per location are 422.',
  })
  @ZodResponse({ status: 200, description: 'The updated role', type: RoleDto })
  update(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto, @Body() body: UpdateRoleRequestDto) {
    return this.updateRole.execute({ actor, ip }, params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteRole', summary: 'Delete a custom role that nobody holds (roles:manage)' })
  @ApiNoContentResponse({ description: 'Role deleted' })
  async remove(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto): Promise<void> {
    await this.deleteRole.execute({ actor, ip }, params.id);
  }
}
