import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';

import { AuthError, InvalidCurrentPassword } from '../domain/auth-errors';

/** Domain auth errors -> HTTP. Messages stay generic (they come from the domain errors). */
export function toHttpError(error: unknown): unknown {
  if (!(error instanceof AuthError)) return error;
  if (error instanceof InvalidCurrentPassword) {
    return new BadRequestException({ code: 'INVALID_CURRENT_PASSWORD', message: error.message });
  }
  return new UnauthorizedException(error.message);
}

/** `await useCase.execute(...).catch(rethrowHttp)` */
export function rethrowHttp(error: unknown): never {
  throw toHttpError(error) as HttpException | Error;
}
