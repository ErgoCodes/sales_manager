import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@monaco/contracts';
import type { Request } from 'express';

import type { AuthenticatedActor } from '../domain/actor';

export const IS_PUBLIC = 'iam:isPublic';
export const ALLOW_PENDING_PASSWORD_CHANGE = 'iam:allowPendingPasswordChange';
export const REQUIRED_PERMISSION = 'iam:requiredPermission';

/**
 * The AuthGuard is global: every route needs a valid access token unless it is
 * explicitly marked public (today: /health, POST /auth/login, POST /auth/refresh).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Routes still reachable while `must_change_password` is set (password, logout, me). */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

/**
 * Coarse, early check: the actor holds the permission somewhere (tenant-wide or
 * in some location). The use case stays the authority and re-checks with the
 * concrete location (ADR 0005).
 */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

declare module 'express-serve-static-core' {
  interface Request {
    actor?: AuthenticatedActor;
  }
}

/** The authenticated actor the AuthGuard attached to the request. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedActor => {
  const actor = context.switchToHttp().getRequest<Request>().actor;
  // Unreachable behind the global AuthGuard; fail closed if a route is misconfigured.
  if (!actor) throw new Error('CurrentActor used on a route without an authenticated actor');
  return actor;
});

/** Client IP as resolved by the signed-header middleware (never X-Forwarded-For). */
export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => context.switchToHttp().getRequest<Request>().clientIp ?? null,
);
