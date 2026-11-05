import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CreateUserRequest, CreateUserResponse, PaginatedUsers, ResetPasswordResponse, UpdateUserRequest, User, UserDetail } from '@monaco/contracts';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import type { AuthenticatedActor } from '../../iam/domain/actor';
import { IdParamsDto, PaginationQueryDto } from '../../iam/http/admin.dto';
import { ClientIp, CurrentActor, RequirePermission } from '../../iam/http/auth.decorators';
import { rethrowHttp } from '../../iam/http/auth-http-errors';
import { CreateUser, DisableUser, GetUser, ListUsers, ResetUserPassword, UpdateUser } from '../application/users.use-cases';

class UserDto extends createZodDto(User) {}
class UserDetailDto extends createZodDto(UserDetail) {}
class PaginatedUsersDto extends createZodDto(PaginatedUsers) {}
class CreateUserRequestDto extends createZodDto(CreateUserRequest) {}
class CreateUserResponseDto extends createZodDto(CreateUserResponse) {}
class UpdateUserRequestDto extends createZodDto(UpdateUserRequest) {}
class ResetPasswordResponseDto extends createZodDto(ResetPasswordResponse) {}

/**
 * POST /users per (client IP, admin): enough to onboard a team, too slow to
 * enumerate the global email space (an existing email is a generic 409).
 */
export const USER_CREATION_LIMIT = { limit: 20, ttl: 60_000 } as const;

@ApiTags('users')
@ApiErrorResponse()
@ApiBearerAuth()
@RequirePermission('users:manage')
@Controller('users')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsers,
    private readonly getUser: GetUser,
    private readonly createUser: CreateUser,
    private readonly updateUser: UpdateUser,
    private readonly disableUser: DisableUser,
    private readonly resetUserPassword: ResetUserPassword,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listUsers', summary: 'Users of the tenant (users:manage)' })
  @ZodResponse({ status: 200, description: 'A page of users', type: PaginatedUsersDto })
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: PaginationQueryDto) {
    return this.listUsers.execute(actor, query).catch(rethrowHttp);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getUser', summary: 'A user with their assignments (users:manage)' })
  @ZodResponse({ status: 200, description: 'The user', type: UserDetailDto })
  get(@CurrentActor() actor: AuthenticatedActor, @Param() params: IdParamsDto) {
    return this.getUser.execute(actor, params.id).catch(rethrowHttp);
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ credential: USER_CREATION_LIMIT })
  @ApiOperation({
    operationId: 'createUser',
    summary: 'Create a user with a temporary password (users:manage)',
    description:
      'The server generates the temporary password, shown once, valid 72 h. An email that already exists (in any tenant) gets a generic 409. Rate limited.',
  })
  @ZodResponse({ status: 201, description: 'The new user and its temporary password', type: CreateUserResponseDto })
  create(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Body() body: CreateUserRequestDto) {
    return this.createUser.execute({ actor, ip }, body).catch(rethrowHttp);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateUser', summary: 'Change the display name (users:manage)' })
  @ZodResponse({ status: 200, description: 'The updated user', type: UserDto })
  update(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto, @Body() body: UpdateUserRequestDto) {
    return this.updateUser.execute({ actor, ip }, params.id, body).catch(rethrowHttp);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'disableUser',
    summary: 'Disable a user and revoke all their devices (users:manage)',
    description: 'Never oneself; an Owner only by an Owner; 409 if it would leave the tenant without an active Owner.',
  })
  @ZodResponse({ status: 200, description: 'The disabled user', type: UserDto })
  disable(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto) {
    return this.disableUser.execute({ actor, ip }, params.id).catch(rethrowHttp);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'resetUserPassword',
    summary: 'Replace the password with a temporary one and revoke all sessions (users:manage)',
    description: 'Never oneself (use POST /auth/password); the caller must cover everything the user holds.',
  })
  @ZodResponse({ status: 200, description: 'The temporary password, shown once', type: ResetPasswordResponseDto })
  resetPassword(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null, @Param() params: IdParamsDto) {
    return this.resetUserPassword.execute({ actor, ip }, params.id).catch(rethrowHttp);
  }
}
