import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ErrorResponse } from '@monaco/contracts';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

const MAX_MESSAGE_LENGTH = 500;
const MAX_DETAILS = 50;
const INTERNAL_MESSAGE = 'Internal server error';

/** Stable machine-readable codes for the HTTP statuses the API emits. */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

type Details = NonNullable<ErrorResponse['error']['details']>;

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

/** Only path + message per issue: Zod issues can carry the rejected input, which must not leak. */
function toDetails(error: ZodError): Details {
  return error.issues.slice(0, MAX_DETAILS).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: truncate(issue.message),
  }));
}

/** Body-parser (JSON syntax, size limit) errors arrive as plain errors with these fields. */
function isClientHttpError(error: unknown): error is { status: number; expose: true; message: string } {
  if (typeof error !== 'object' || error === null) return false;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

export interface MappedError {
  status: number;
  body: ErrorResponse;
}

/**
 * Pure mapping from any thrown value to the contract's `ErrorResponse`.
 * 5xx always get a generic message; internals go to the log, never the client.
 */
export function mapException(exception: unknown): MappedError {
  if (exception instanceof ZodValidationException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: toDetails(exception.getZodError() as ZodError),
        },
      },
    };
  }

  if (exception instanceof HttpException && !(exception instanceof ZodSerializationException)) {
    const status = exception.getStatus();
    if (status < 500) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : exception.message;
      return {
        status,
        body: { error: { code: CODE_BY_STATUS[status] ?? 'CLIENT_ERROR', message: truncate(message) } },
      };
    }
    // Keep the status (e.g. 503 tells clients to retry) but never the message.
    return {
      status,
      body: { error: { code: CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } },
    };
  }

  if (isClientHttpError(exception)) {
    return {
      status: exception.status,
      body: {
        error: {
          code: CODE_BY_STATUS[exception.status] ?? 'CLIENT_ERROR',
          message: truncate(exception.message),
        },
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } },
  };
}

/**
 * Global filter: every error leaves the API as `ErrorResponse`. Server errors
 * (including responses that fail their own contract) are logged with the
 * request id; the client only gets the generic message and the
 * `x-request-id` header to quote in a bug report.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { status, body } = mapException(exception);

    if (status >= 500) {
      const err =
        exception instanceof ZodSerializationException
          ? { message: 'Response failed its contract', issues: exception.getZodError() }
          : exception;
      this.logger.error({ err, reqId: request.id, method: request.method, url: request.originalUrl }, 'Unhandled error');
    }

    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
