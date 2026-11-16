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
 * Directly maps IAM domain and auth errors to contract-compliant status and body,
 * avoiding middle-man HttpException allocation and recursive filter unwrapping.
 */
export function toMappedDomainError(error: unknown): { status: number; body: { error: { code: string; message: string } } } | null {
  if (error instanceof InvalidCurrentPassword) {
    return { status: HttpStatus.BAD_REQUEST, body: { error: { code: 'INVALID_CURRENT_PASSWORD', message: error.message } } };
  }
  if (error instanceof AuthError) {
    return { status: HttpStatus.UNAUTHORIZED, body: { error: { code: 'UNAUTHORIZED', message: error.message } } };
  }
  if (error instanceof PermissionDenied || error instanceof ForbiddenEscalation) {
    return { status: HttpStatus.FORBIDDEN, body: { error: { code: 'FORBIDDEN', message: 'Forbidden' } } };
  }
  if (error instanceof ResourceNotFound) {
    return { status: HttpStatus.NOT_FOUND, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  }
  if (error instanceof ResourceConflict) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'CONFLICT', message: error.message } } };
  }
  if (error instanceof InvalidCursor) {
    return { status: HttpStatus.BAD_REQUEST, body: { error: { code: 'INVALID_CURSOR', message: error.message } } };
  }
  if (error instanceof OwnerInvariantViolation) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'LAST_OWNER', message: 'The tenant must keep at least one active Owner' } } };
  }
  if (error instanceof SystemRoleImmutable) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'SYSTEM_ROLE_IMMUTABLE', message: error.message } } };
  }
  if (error instanceof RoleInUse) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'ROLE_IN_USE', message: error.message } } };
  }
  if (error instanceof InvalidScope) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, body: { error: { code: 'INVALID_SCOPE', message: 'Invalid assignment scope' } } };
  }
  return null;
}

/**
 * IAM domain errors -> HTTP (ADR 0005 §6). Messages stay generic: a 403 never
 * says which rule failed (the escalation reason goes to the audit log), and a
 * resource of another tenant is a plain 404.
 */
export function toHttpError(error: unknown): unknown {
  const mapped = toMappedDomainError(error);
  if (!mapped) return error;
  if (mapped.status === HttpStatus.UNAUTHORIZED) {
    return new UnauthorizedException(mapped.body.error.message);
  }
  if (mapped.status === HttpStatus.NOT_FOUND) {
    return new NotFoundException(mapped.body.error.message);
  }
  if (mapped.status === HttpStatus.FORBIDDEN) {
    return new ForbiddenException(mapped.body.error.message);
  }
  if (mapped.status === HttpStatus.CONFLICT) {
    return mapped.body.error.code === 'CONFLICT'
      ? new ConflictException(mapped.body.error.message)
      : new ConflictException(mapped.body.error);
  }
  if (mapped.status === HttpStatus.BAD_REQUEST) {
    return new BadRequestException(mapped.body.error);
  }
  return new HttpException(mapped.body.error, mapped.status);
}

/** `await useCase.execute(...).catch(rethrowHttp)` */
export function rethrowHttp(error: unknown): never {
  throw toHttpError(error) as HttpException | Error;
}
