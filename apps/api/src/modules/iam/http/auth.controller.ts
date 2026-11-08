import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';

import { ApiErrorResponse } from '../../../common/http/api-error-response.decorator';
import { ChangePassword } from '../application/change-password.use-case';
import { Login } from '../application/login.use-case';
import { Logout } from '../application/logout.use-case';
import { RefreshSession } from '../application/refresh-session.use-case';
import type { AuthenticatedActor } from '../domain/actor';
import { AllowPendingPasswordChange, ClientIp, CurrentActor, Public } from './auth.decorators';
import { AuthTokensDto, ChangePasswordRequestDto, LoginRequestDto, RefreshRequestDto, RefreshResponseDto } from './auth.dto';
import { rethrowHttp } from './auth-http-errors';

@ApiTags('auth')
@ApiErrorResponse()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly login: Login,
    private readonly refreshSession: RefreshSession,
    private readonly logout: Logout,
    private readonly changePassword: ChangePassword,
  ) {}

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'login',
    summary: 'Log in with email and password',
    description:
      'Creates or reuses a device and starts a new session (refresh family). Every failure is the same 401. Rate limited per IP and per (IP, email).',
  })
  @ZodResponse({ status: 200, description: 'Access and refresh tokens', type: AuthTokensDto })
  postLogin(@Body() body: LoginRequestDto, @ClientIp() ip: string | null) {
    return this.login.execute({ ...body, ip }).catch(rethrowHttp);
  }

  @Post('refresh')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ credential: true })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'refresh',
    summary: 'Rotate a refresh token',
    description:
      'Returns a new access token and a new refresh token. Within 10 s of a rotation the old token only gets an access token; after that, reusing it revokes the whole session (401). Rate limited per IP.',
  })
  @ZodResponse({ status: 200, description: 'New tokens', type: RefreshResponseDto })
  postRefresh(@Body() body: RefreshRequestDto, @ClientIp() ip: string | null) {
    return this.refreshSession.execute({ refreshToken: body.refreshToken, ip }).catch(rethrowHttp);
  }

  @Post('logout')
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'logout', summary: 'Revoke the current session' })
  @ApiNoContentResponse({ description: 'Session revoked' })
  async postLogout(@CurrentActor() actor: AuthenticatedActor, @ClientIp() ip: string | null): Promise<void> {
    await this.logout.execute(actor, ip);
  }

  @Post('password')
  @AllowPendingPasswordChange()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'changePassword',
    summary: 'Change the own password',
    description:
      'Requires the current password. Revokes every other device of the user and rotates the current session: use the returned tokens. Rate limited per IP and per (IP, user).',
  })
  @ZodResponse({ status: 200, description: 'New tokens for the current device', type: AuthTokensDto })
  postPassword(@CurrentActor() actor: AuthenticatedActor, @Body() body: ChangePasswordRequestDto, @ClientIp() ip: string | null) {
    return this.changePassword.execute(actor, { ...body, ip }).catch(rethrowHttp);
  }
}
