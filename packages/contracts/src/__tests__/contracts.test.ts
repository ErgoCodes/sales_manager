import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ErrorResponse,
  HealthResponse,
  IsoDateTime,
  Money,
  Paginated,
  PaginationQuery,
  Uuid,
} from '../index';

const V7 = '018f3b5e-7c1a-7000-8000-0123456789ab';

describe('Uuid', () => {
  it('accepts UUIDv7', () => expect(Uuid.safeParse(V7).success).toBe(true));
  it('rejects v4 and garbage', () => {
    expect(Uuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(false);
    expect(Uuid.safeParse('nope').success).toBe(false);
  });
});

describe('IsoDateTime', () => {
  it('accepts UTC instants', () =>
    expect(IsoDateTime.safeParse('2026-11-04T12:00:00Z').success).toBe(true));
  it('rejects offsets and dates', () => {
    expect(IsoDateTime.safeParse('2026-11-04T12:00:00+02:00').success).toBe(false);
    expect(IsoDateTime.safeParse('2026-11-04').success).toBe(false);
  });
});

describe('Money', () => {
  it('accepts integer cents', () =>
    expect(Money.safeParse({ amount: 12550, currency: 'CUP' }).success).toBe(true));
  it('rejects fractions, bad currency, missing fields', () => {
    expect(Money.safeParse({ amount: 1.5, currency: 'CUP' }).success).toBe(false);
    expect(Money.safeParse({ amount: 1, currency: 'cup' }).success).toBe(false);
    expect(Money.safeParse({ amount: 1 }).success).toBe(false);
  });
});

describe('ErrorResponse', () => {
  it('accepts with and without details', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'X', message: 'm' } }).success).toBe(true);
    expect(
      ErrorResponse.safeParse({ error: { code: 'X', message: 'm', details: { a: 1 } } }).success,
    ).toBe(true);
  });
  it('rejects empty code or missing envelope', () => {
    expect(ErrorResponse.safeParse({ error: { code: '', message: 'm' } }).success).toBe(false);
    expect(ErrorResponse.safeParse({ code: 'X', message: 'm' }).success).toBe(false);
  });
});

describe('Paginated', () => {
  const Page = Paginated(z.object({ id: Uuid }), 'PaginatedThings');
  it('accepts a page and a last page', () => {
    expect(Page.safeParse({ items: [{ id: V7 }], nextCursor: 'abc' }).success).toBe(true);
    expect(Page.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });
  it('rejects invalid items or missing cursor', () => {
    expect(Page.safeParse({ items: [{ id: 'x' }], nextCursor: null }).success).toBe(false);
    expect(Page.safeParse({ items: [] }).success).toBe(false);
  });
  it('exposes its own OpenAPI id', () => {
    expect(z.globalRegistry.get(Page)?.id).toBe('PaginatedThings');
  });
});

describe('PaginationQuery', () => {
  it('defaults limit and coerces strings', () => {
    expect(PaginationQuery.parse({}).limit).toBe(50);
    expect(PaginationQuery.parse({ limit: '10', cursor: 'c' })).toEqual({ limit: 10, cursor: 'c' });
  });
  it('rejects out-of-range limit', () => {
    expect(PaginationQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(PaginationQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('HealthResponse', () => {
  it('accepts valid', () =>
    expect(HealthResponse.safeParse({ status: 'ok', version: '0.1.0', db: 'up' }).success).toBe(true));
  it('rejects invalid db value', () =>
    expect(HealthResponse.safeParse({ status: 'ok', version: '0.1.0', db: 'maybe' }).success).toBe(false));
});

describe('OpenAPI metadata', () => {
  it('generates JSON Schema with named ids', () => {
    expect(z.globalRegistry.get(Money)?.id).toBe('Money');
    const js = z.toJSONSchema(HealthResponse, { reused: 'ref' }) as {
      $defs?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    };
    const props = js.properties ?? (js.$defs?.HealthResponse as { properties: object }).properties;
    expect(Object.keys(props)).toEqual(['status', 'version', 'db']);
  });
});
