import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthError, InvalidCurrentPassword } from '../domain/auth-errors';
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
} from '../domain/errors';

/**
 * IAM domain errors -> HTTP (ADR 0005 §6). Messages stay generic: a 403 never
 * says which rule failed (the escalation reason goes to the audit log), and a
 * resource of another tenant is a plain 404.
 */
export function toHttpError(error: unknown): unknown {
  if (error instanceof AuthError) {
    if (error instanceof InvalidCurrentPassword) {
      return new BadRequestException({ code: 'INVALID_CURRENT_PASSWORD', message: error.message });
    }
    return new UnauthorizedException(error.message);
  }
  if (error instanceof PermissionDenied || error instanceof ForbiddenEscalation) return new ForbiddenException('Forbidden');
  if (error instanceof ResourceNotFound) return new NotFoundException('Not found');
  if (error instanceof ResourceConflict) return new ConflictException(error.message);
  if (error instanceof InvalidCursor) return new BadRequestException({ code: 'INVALID_CURSOR', message: error.message });
  if (error instanceof OwnerInvariantViolation) {
    return new ConflictException({ code: 'LAST_OWNER', message: 'The tenant must keep at least one active Owner' });
  }
  if (error instanceof SystemRoleImmutable) return new ConflictException({ code: 'SYSTEM_ROLE_IMMUTABLE', message: error.message });
  if (error instanceof RoleInUse) return new ConflictException({ code: 'ROLE_IN_USE', message: error.message });
  if (error instanceof InvalidScope) {
    return new HttpException({ code: 'INVALID_SCOPE', message: 'Invalid assignment scope' }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return error;
}

/** `await useCase.execute(...).catch(rethrowHttp)` */
export function rethrowHttp(error: unknown): never {
  throw toHttpError(error) as HttpException | Error;
}
