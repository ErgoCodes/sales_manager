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
  it('rejects uppercase and bad variant', () => {
    expect(Uuid.safeParse(V7.toUpperCase()).success).toBe(false);
    expect(Uuid.safeParse('018f3b5e-7c1a-7000-c000-0123456789ab').success).toBe(false);
  });
  it('rejects v4 and garbage', () => {
    expect(Uuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(false);
    expect(Uuid.safeParse('nope').success).toBe(false);
  });
});

describe('IsoDateTime', () => {
  it('accepts UTC instants', () =>
    expect(IsoDateTime.safeParse('2026-11-04T12:00:00Z').success).toBe(true));
  it('accepts fractional seconds', () =>
    expect(IsoDateTime.safeParse('2026-11-04T12:00:00.123Z').success).toBe(true));
  it('rejects impossible dates', () =>
    expect(IsoDateTime.safeParse('2026-02-30T12:00:00Z').success).toBe(false));
  it('rejects offsets and dates', () => {
    expect(IsoDateTime.safeParse('2026-11-04T12:00:00+02:00').success).toBe(false);
    expect(IsoDateTime.safeParse('2026-11-04').success).toBe(false);
  });
});

describe('Money', () => {
  it('accepts integer cents', () =>
    expect(Money.safeParse({ amount: 12550, currency: 'CUP' }).success).toBe(true));
  it('bounds amount to safe integers', () => {
    expect(Money.safeParse({ amount: Number.MAX_SAFE_INTEGER, currency: 'USD' }).success).toBe(true);
    expect(Money.safeParse({ amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' }).success).toBe(false);
  });
  it('rejects fractions, bad currency, missing fields', () => {
    expect(Money.safeParse({ amount: 1.5, currency: 'CUP' }).success).toBe(false);
    expect(Money.safeParse({ amount: -1, currency: 'CUP' }).success).toBe(false);
    expect(Money.safeParse({ amount: 1, currency: 'cup' }).success).toBe(false);
    expect(Money.safeParse({ amount: 1, currency: 'EUR' }).success).toBe(false);
    expect(Money.safeParse({ amount: 1 }).success).toBe(false);
  });
});

describe('ErrorResponse', () => {
  it('accepts with and without details', () => {
    expect(ErrorResponse.safeParse({ error: { code: 'X', message: 'm' } }).success).toBe(true);
    expect(
      ErrorResponse.safeParse({ error: { code: 'X', message: 'm', details: [{ path: 'a.b', message: 'bad' }] } }).success,
    ).toBe(true);
  });
  it('rejects empty code or missing envelope', () => {
    expect(ErrorResponse.safeParse({ error: { code: '', message: 'm' } }).success).toBe(false);
    expect(ErrorResponse.safeParse({ error: { code: 'X', message: 'm', details: { a: 1 } } }).success).toBe(false);
    expect(ErrorResponse.safeParse({ error: { code: 'X', message: 'm'.repeat(501) } }).success).toBe(false);
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
  it('accepts numbers and rejects non-digit strings', () => {
    expect(PaginationQuery.parse({ limit: 7 }).limit).toBe(7);
    for (const bad of ['10abc', '', '0x10', '1e1', ' 5', '-1']) {
      expect(PaginationQuery.safeParse({ limit: bad }).success).toBe(false);
    }
  });
  it('limits cursor length', () => {
    expect(PaginationQuery.safeParse({ cursor: 'c'.repeat(512) }).success).toBe(true);
    expect(PaginationQuery.safeParse({ cursor: 'c'.repeat(513) }).success).toBe(false);
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
  it('emits expected ids in $defs', () => {
    const Page = Paginated(Money, 'PaginatedMoney');
    const Root = z.object({ h: HealthResponse, e: ErrorResponse, m: Money, u: Uuid, d: IsoDateTime, p: Page });
    const js = z.toJSONSchema(Root, { reused: 'ref' }) as { $defs?: Record<string, unknown> };
    expect(Object.keys(js.$defs ?? {})).toEqual(
      expect.arrayContaining(['ErrorResponse', 'HealthResponse', 'IsoDateTime', 'Money', 'PaginatedMoney', 'Uuid']),
    );
  });
});
