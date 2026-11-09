import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import type { ErrorResponse } from '@monaco/contracts';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

import { BODY_PARSER_MESSAGES } from './body-parsers';

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
function isClientHttpError(error: unknown): error is { status: number; expose: true; type?: unknown } {
  if (typeof error !== 'object' || error === null) return false;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

/** Path without query string: queries may carry tokens or PII. */
export function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * A 4xx thrown as `new HttpException({ code, message }, status)` keeps its own
 * machine-readable code (e.g. PASSWORD_CHANGE_REQUIRED) when it looks like one.
 */
function explicitCode(response: string | object): string | undefined {
  const code = typeof response === 'object' ? (response as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z_]{2,63}$/.test(code) ? code : undefined;
}

/** Nest's unmatched-route 404 is `Cannot <METHOD> <url>`, url including the query. */
const ROUTE_NOT_FOUND = /^Cannot ([A-Z]+) (.*)$/s;

/** SQLSTATE of a Postgres error, also when Drizzle wraps it ("Failed query", error in `cause`). */
function pgCode(error: unknown): string | undefined {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const code = typeof candidate === 'object' && candidate !== null ? (candidate as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/**
 * Constraint violations that clients can trigger (ADR 0003, SP2 spec). Generic
 * on purpose: a composite FK failing on another tenant's id is a plain 404 (it
 * must not confirm the id exists), and a 409 never names the constraint.
 */
const CONSTRAINT_ERRORS: Record<string, MappedError> = {
  '23503': { status: HttpStatus.NOT_FOUND, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } },
  '23505': { status: HttpStatus.CONFLICT, body: { error: { code: 'CONFLICT', message: 'Conflict' } } },
};

export interface MappedError {
  status: number;
  body: ErrorResponse;
}

export type ExceptionMapper = (exception: unknown) => MappedError | null;

export const EXCEPTION_MAPPERS = Symbol('EXCEPTION_MAPPERS');

/**
 * Pure mapping from any thrown value to the contract's `ErrorResponse`.
 * 5xx always get a generic message; internals go to the log, never the client.
 */
export function mapException(exception: unknown, mappers: readonly ExceptionMapper[] = []): MappedError {
  for (const mapper of mappers) {
    const mapped = mapper(exception);
    if (mapped) return mapped;
  }

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
      const routeNotFound = status === HttpStatus.NOT_FOUND ? ROUTE_NOT_FOUND.exec(message) : null;
      const safeMessage = routeNotFound ? `Cannot ${routeNotFound[1]} ${stripQuery(routeNotFound[2])}` : message;
      return {
        status,
        body: { error: { code: explicitCode(response) ?? CODE_BY_STATUS[status] ?? 'CLIENT_ERROR', message: truncate(safeMessage) } },
      };
    }
    // Keep the status (e.g. 503 tells clients to retry) but never the message.
    return {
      status,
      body: { error: { code: CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } },
    };
  }

  if (isClientHttpError(exception)) {
    const known = typeof exception.type === 'string' ? BODY_PARSER_MESSAGES[exception.type] : undefined;
    return {
      status: exception.status,
      body: {
        error: {
          code: CODE_BY_STATUS[exception.status] ?? 'CLIENT_ERROR',
          message: known ?? 'Invalid request',
        },
      },
    };
  }

  const constraint = CONSTRAINT_ERRORS[pgCode(exception) ?? ''];
  if (constraint) return constraint;

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
  private readonly mappers: readonly ExceptionMapper[];

  constructor(
    private readonly logger: PinoLogger,
    @Optional()
    @Inject(EXCEPTION_MAPPERS)
    mappers?: ExceptionMapper | readonly ExceptionMapper[],
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
    this.mappers = mappers ? (Array.isArray(mappers) ? mappers : [mappers]) : [];
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { status, body } = mapException(exception, this.mappers);

    if (status >= 500) {
      const err =
        exception instanceof ZodSerializationException
          ? { message: 'Response failed its contract', issues: exception.getZodError() }
          : exception;
      this.logger.error({ err, reqId: request.id, method: request.method, path: stripQuery(request.originalUrl) }, 'Unhandled error');
    }

    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
