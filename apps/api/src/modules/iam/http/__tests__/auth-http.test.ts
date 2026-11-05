import { BadRequestException, type ExecutionContext, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { Authenticate } from '../../application/authenticate.use-case';
import type { AuthenticatedActor } from '../../domain/actor';
import { InvalidCredentials, InvalidCurrentPassword, InvalidSession } from '../../domain/auth-errors';
import { effectivePermissions } from '../../domain/permissions';
import { AuthController } from '../auth.controller';
import { AllowPendingPasswordChange, ClientIp, CurrentActor, Public, RequirePermission } from '../auth.decorators';
import { AuthGuard } from '../auth.guard';
import { mapException } from '../../../../common/http/all-exceptions.filter';
import {
  ForbiddenEscalation,
  InvalidCursor,
  InvalidScope,
  OwnerInvariantViolation,
  PermissionDenied,
  ResourceConflict,
  ResourceNotFound,
  RoleInUse,
  SystemRoleImmutable,
} from '../../domain/errors';
import { rethrowHttp, toHttpError } from '../auth-http-errors';
import { MeController } from '../me.controller';

const LOCATION = '0190a000-0000-7000-8000-0000000000aa';
const actor = (overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor => {
  const assignments = [{ role: { id: 'r', key: null, isSystem: false, permissions: ['sales:create' as const] }, scope: { type: 'locations' as const, locationIds: [LOCATION] } }];
  return { userId: 'u', tenantId: 't', deviceId: 'd', sessionId: 's', mustChangePassword: false, assignments, effective: effectivePermissions(assignments), ...overrides };
};

class Routes {
  @Public() open() {}
  closed() {}
  @AllowPendingPasswordChange() pending() {}
  @RequirePermission('sales:create') sell() {}
  @RequirePermission('users:manage') manageUsers() {}
}

function context(handler: keyof Routes, headers: Record<string, string> = {}) {
  const request: { headers: Record<string, string>; actor?: AuthenticatedActor; clientIp?: string | null } = { headers };
  const ctx = {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guard(result: AuthenticatedActor | null) {
  const execute = vi.fn(async () => result);
  return { guard: new AuthGuard(new Reflector(), { execute } as unknown as Authenticate), execute };
}

const BEARER = { authorization: 'Bearer aaa.bbb.ccc' };

describe('AuthGuard', () => {
  it('lets @Public() routes through without a token', async () => {
    const { guard: g, execute } = guard(null);
    await expect(g.canActivate(context('open').ctx)).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ authorization: 'Basic abc' }], [{ authorization: 'Bearer not-a-jwt' }], [{ authorization: `Bearer a.b.${'c'.repeat(5000)}` }]])(
    'answers 401 without a well-formed bearer token (%j)',
    async (headers) => {
      const { guard: g, execute } = guard(actor());
      await expect(g.canActivate(context('closed', headers).ctx)).rejects.toThrow(new UnauthorizedException('Authentication required'));
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('answers 401 when the token does not resolve to a live actor', async () => {
    const { guard: g, execute } = guard(null);
    await expect(g.canActivate(context('closed', BEARER).ctx)).rejects.toThrow(new UnauthorizedException('Invalid or expired token'));
    expect(execute).toHaveBeenCalledWith('aaa.bbb.ccc');
  });

  it('attaches the actor to the request', async () => {
    const resolved = actor();
    const { ctx, request } = context('closed', BEARER);
    await expect(guard(resolved).guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.actor).toBe(resolved);
  });

  it('blocks a pending password change except on allow-listed routes', async () => {
    const { guard: g } = guard(actor({ mustChangePassword: true }));
    const error = await g.canActivate(context('closed', BEARER).ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
    expect((error as HttpException).getResponse()).toEqual({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required' });
    await expect(g.canActivate(context('pending', BEARER).ctx)).resolves.toBe(true);
  });

  it('@RequirePermission passes with the permission anywhere and answers 403 otherwise', async () => {
    const { guard: g } = guard(actor());
    await expect(g.canActivate(context('sell', BEARER).ctx)).resolves.toBe(true);
    await expect(g.canActivate(context('manageUsers', BEARER).ctx)).rejects.toThrow(new ForbiddenException('Forbidden'));
  });
});

/** Runs a param decorator's factory the way Nest does. */
function paramFactory(decorator: () => ParameterDecorator) {
  class Target {
    handler(_value: unknown) {}
  }
  decorator()(Target.prototype, 'handler', 0);
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Target, 'handler') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
  return Object.values(metadata)[0]!.factory;
}

describe('param decorators', () => {
  it('CurrentActor returns the request actor and fails closed without one', () => {
    const factory = paramFactory(CurrentActor);
    const { ctx, request } = context('closed');
    expect(() => factory(undefined, ctx)).toThrow(/without an authenticated actor/);
    request.actor = actor();
    expect(factory(undefined, ctx)).toBe(request.actor);
  });

  it('ClientIp returns the resolved client IP or null', () => {
    const factory = paramFactory(ClientIp);
    const { ctx, request } = context('closed');
    expect(factory(undefined, ctx)).toBeNull();
    request.clientIp = '10.0.0.1';
    expect(factory(undefined, ctx)).toBe('10.0.0.1');
  });
});

describe('auth HTTP errors', () => {
  it('maps auth errors to generic 401/400 and passes anything else through', () => {
    expect(toHttpError(new InvalidCredentials())).toEqual(new UnauthorizedException('Invalid email or password'));
    expect(toHttpError(new InvalidSession())).toEqual(new UnauthorizedException('Invalid or expired session'));
    const bad = toHttpError(new InvalidCurrentPassword()) as BadRequestException;
    expect(bad.getResponse()).toEqual({ code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect' });
    const other = new Error('boom');
    expect(toHttpError(other)).toBe(other);
    expect(() => rethrowHttp(new InvalidSession())).toThrow(UnauthorizedException);
  });

  it.each([
    [new PermissionDenied('users:manage'), 403, { code: 'FORBIDDEN', message: 'Forbidden' }],
    [new ForbiddenEscalation('owner_only'), 403, { code: 'FORBIDDEN', message: 'Forbidden' }],
    [new ResourceNotFound('user'), 404, { code: 'NOT_FOUND', message: 'Not found' }],
    [new ResourceConflict('Could not create the user'), 409, { code: 'CONFLICT', message: 'Could not create the user' }],
    [new InvalidCursor(), 400, { code: 'INVALID_CURSOR', message: 'Invalid cursor' }],
    [new OwnerInvariantViolation(), 409, { code: 'LAST_OWNER', message: 'The tenant must keep at least one active Owner' }],
    [new SystemRoleImmutable('delete'), 409, { code: 'SYSTEM_ROLE_IMMUTABLE', message: 'System role cannot be deleted' }],
    [new RoleInUse(), 409, { code: 'ROLE_IN_USE', message: 'Role still has assignments' }],
    [new InvalidScope('admin_permission_requires_tenant_scope'), 422, { code: 'INVALID_SCOPE', message: 'Invalid assignment scope' }],
  ])('maps %o to its status and a generic ErrorResponse', (error, status, body) => {
    expect(mapException(toHttpError(error))).toEqual({ status, body: { error: body } });
  });
});

describe('controllers delegate to the use cases', () => {
  it('AuthController', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: 'd', mustChangePassword: false };
    const useCase = (result: unknown) => ({ execute: vi.fn(async () => result) });
    const login = useCase(tokens);
    const refresh = useCase({ accessToken: 'a', expiresIn: 600 });
    const logout = useCase(undefined);
    const change = useCase(tokens);
    const controller = new AuthController(login as never, refresh as never, logout as never, change as never);
    const me = actor();

    await expect(controller.postLogin({ email: 'a@b.co', password: 'x'.repeat(12) }, '10.0.0.1')).resolves.toBe(tokens);
    expect(login.execute).toHaveBeenCalledWith({ email: 'a@b.co', password: 'x'.repeat(12), ip: '10.0.0.1' });
    await controller.postRefresh({ refreshToken: 'r' }, null);
    expect(refresh.execute).toHaveBeenCalledWith({ refreshToken: 'r', ip: null });
    await controller.postLogout(me, null);
    expect(logout.execute).toHaveBeenCalledWith(me, null);
    await controller.postPassword(me, { currentPassword: 'old', newPassword: 'n'.repeat(12) }, null);
    expect(change.execute).toHaveBeenCalledWith(me, { currentPassword: 'old', newPassword: 'n'.repeat(12), ip: null });

    login.execute.mockRejectedValueOnce(new InvalidCredentials());
    await expect(controller.postLogin({ email: 'a@b.co', password: 'x'.repeat(12) }, null)).rejects.toThrow(UnauthorizedException);
  });

  it('MeController', async () => {
    const getMe = { execute: vi.fn(async () => ({ ok: true })) };
    const controller = new MeController(getMe as never);
    await expect(controller.get(actor())).resolves.toEqual({ ok: true });
    getMe.execute.mockRejectedValueOnce(new InvalidSession());
    await expect(controller.get(actor())).rejects.toThrow(UnauthorizedException);
  });
});
