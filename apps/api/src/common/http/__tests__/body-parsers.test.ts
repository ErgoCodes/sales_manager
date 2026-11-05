import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { toBodyParserException } from '../body-parsers';

const parserError = (fields: object) => Object.assign(new SyntaxError('Unexpected token in {"pw":"s3cret"'), fields);

describe('toBodyParserException', () => {
  it.each([
    [{ status: 400, expose: true, type: 'entity.parse.failed' }, 400, 'Malformed JSON body'],
    [{ status: 413, expose: true, type: 'entity.too.large' }, 413, 'Payload too large'],
    [{ status: 415, expose: true, type: 'charset.unsupported' }, 415, 'Unsupported charset'],
    [{ status: 400, expose: true, type: 'other' }, 400, 'Invalid request'],
    [{ status: 400, expose: true }, 400, 'Invalid request'],
  ])('maps %j to a fixed message', (fields, status, message) => {
    const mapped = toBodyParserException(parserError(fields));
    expect(mapped).toBeInstanceOf(HttpException);
    expect((mapped as HttpException).getStatus()).toBe(status);
    expect((mapped as HttpException).message).toBe(message);
  });

  it.each([
    ['a non-exposed error', parserError({ status: 400 })],
    ['a 5xx', parserError({ status: 500, expose: true })],
    ['an error without status', new Error('x')],
    ['a non-object', 'boom'],
  ])('passes %s through untouched', (_label, error) => {
    expect(toBodyParserException(error)).toBe(error);
  });
});
