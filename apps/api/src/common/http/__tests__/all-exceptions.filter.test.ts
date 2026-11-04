import {
  type ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ErrorResponse } from '@monaco/contracts';
import type { PinoLogger } from 'nestjs-pino';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AllExceptionsFilter, mapException, stripQuery } from '../all-exceptions.filter';

function zodErrorFor(schema: z.ZodType, input: unknown): z.ZodError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected a failure');
  return result.error;
}

describe('mapException', () => {
  it('maps validation errors to 400 with path + message details only', () => {
    const error = zodErrorFor(z.object({ name: z.string(), items: z.array(z.int()) }), {
      name: 1,
      items: ['secret-input'],
    });
    const { status, body } = mapException(new ZodValidationException(error));

    expect(status).toBe(400);
    expect(ErrorResponse.parse(body)).toEqual(body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([
      { path: 'name', message: expect.any(String) },
      { path: 'items.0', message: expect.any(String) },
    ]);
    expect(JSON.stringify(body)).not.toContain('secret-input');
  });

  it('keeps the message of 4xx HttpExceptions', () => {
    expect(mapException(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Cannot GET /nope' } },
    });
    expect(mapException(new BadRequestException()).body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Bad Request',
    });
  });

  it('truncates long client messages to the contract limit', () => {
    const { body } = mapException(new BadRequestException('x'.repeat(2_000)));
    expect(body.error.message).toHaveLength(500);
    expect(() => ErrorResponse.parse(body)).not.toThrow();
  });

  it('maps body-parser errors to fixed messages, never echoing their text', () => {
    const parse = Object.assign(new SyntaxError('Unexpected token s in JSON at position 9: {"pw":"s3cret"'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    expect(mapException(parse)).toEqual({
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } },
    });
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });
    expect(mapException(tooLarge)).toEqual({
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' } },
    });
    const unknown = Object.assign(new Error('odd internals'), { status: 418, expose: true, type: 'x' });
    expect(mapException(unknown).body.error).toEqual({ code: 'CLIENT_ERROR', message: 'Invalid request' });
    const untyped = Object.assign(new Error('odd internals'), { status: 400, expose: true });
    expect(mapException(untyped).body.error.message).toBe('Invalid request');
  });

  it('drops the query string from route-not-found messages', () => {
    expect(mapException(new NotFoundException('Cannot GET /nope?token=abc&x=1')).body.error.message).toBe(
      'Cannot GET /nope',
    );
    expect(mapException(new NotFoundException('Product not found?')).body.error.message).toBe('Product not found?');
  });

  it('keeps the status of other 5xx HttpExceptions but not their message', () => {
    expect(mapException(new ServiceUnavailableException('db.internal:5432 refused'))).toEqual({
      status: 503,
      body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal server error' } },
    });
  });

  it.each([
    ['a plain Error with internals', new Error('select * from users where password = ...')],
    ['a 5xx HttpException', new InternalServerErrorException('pool exhausted at db.internal:5432')],
    ['a response that broke its contract', new ZodSerializationException(zodErrorFor(z.string(), 1))],
    ['a non-error value', 'boom'],
    ['an error-like object that does not expose itself', { status: 400, message: 'internal' }],
  ])('hides %s behind a generic 500', (_label, exception) => {
    expect(mapException(exception)).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    });
  });
});

describe('AllExceptionsFilter', () => {
  function setup(headersSent = false) {
    const logger = { setContext: vi.fn(), error: vi.fn() };
    const json = vi.fn();
    const response = { headersSent, status: vi.fn(() => ({ json })) };
    const request = { id: 'req-1', method: 'GET', originalUrl: '/x?token=abc' };
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new AllExceptionsFilter(logger as unknown as PinoLogger);
    return { filter, host, logger, response, json };
  }

  it('logs server errors with the request id and answers with the generic body', () => {
    const { filter, host, logger, response, json } = setup();
    const boom = new Error('connection string postgres://u:p@db');
    filter.catch(boom, host);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, reqId: 'req-1', method: 'GET', path: '/x' }),
      'Unhandled error',
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  it('logs contract violations of responses with their Zod issues', () => {
    const { filter, host, logger } = setup();
    filter.catch(new ZodSerializationException(zodErrorFor(z.string(), 1)), host);
    expect(logger.error.mock.calls[0][0].err).toMatchObject({ message: 'Response failed its contract' });
  });

  it('does not log client errors', () => {
    const { filter, host, logger, response } = setup();
    filter.catch(new NotFoundException(), host);
    expect(logger.error).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('does not write twice when headers were already sent', () => {
    const { filter, host, response } = setup(true);
    filter.catch(new Error('late'), host);
    expect(response.status).not.toHaveBeenCalled();
  });
});

describe('stripQuery', () => {
  it.each([
    ['/a?b=1', '/a'],
    ['/a', '/a'],
    ['/?', '/'],
  ])('%s -> %s', (url, expected) => {
    expect(stripQuery(url)).toBe(expected);
  });
});
