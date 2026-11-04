import { applyDecorators } from '@nestjs/common';
import { ApiDefaultResponse } from '@nestjs/swagger';

import { ErrorResponseDto } from './error-response.dto';

/**
 * Documents that any non-2xx answer of the decorated controller or route uses
 * `ErrorResponse` (what AllExceptionsFilter emits). Put it on every controller.
 */
export const ApiErrorResponse = (): MethodDecorator & ClassDecorator =>
  applyDecorators(ApiDefaultResponse({ description: 'Error (see ErrorResponse.code)', type: ErrorResponseDto }));
