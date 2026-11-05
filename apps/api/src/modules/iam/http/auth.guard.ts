import { type CanActivate, type ExecutionContext, ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Permission } from '@monaco/contracts';
import type { Request } from 'express';

import type { Authenticate } from '../application/authenticate.use-case';
import { hasPermissionAnywhere } from '../domain/permissions';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC, REQUIRED_PERMISSION } from './auth.decorators';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_TOKEN_LENGTH = 4096;

/**
 * Global guard (APP_GUARD). Every route but the `@Public()` ones needs
 * `Authorization: Bearer <access token>`; the token is verified and the actor
 * is re-checked against the database on every request (see `Authenticate`).
 * While `must_change_password` is set, only `@AllowPendingPasswordChange()`
 * routes answer; the rest get 403 PASSWORD_CHANGE_REQUIRED.
 */
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticate: Authenticate,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const match = header && header.length <= MAX_TOKEN_LENGTH ? BEARER.exec(header) : null;
    if (!match) throw new UnauthorizedException('Authentication required');

    const actor = await this.authenticate.execute(match[1]!);
    if (!actor) throw new UnauthorizedException('Invalid or expired token');
    request.actor = actor;

    if (actor.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, targets)) {
      throw new HttpException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required' }, HttpStatus.FORBIDDEN);
    }

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, targets);
    if (permission && !hasPermissionAnywhere(actor.effective, permission)) throw new ForbiddenException('Forbidden');
    return true;
  }
}
