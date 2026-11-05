import { describe, expect, it } from 'vitest';

import { uuidv7 } from '../uuidv7';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('has the version 7 and RFC 9562 variant bits', () => {
    for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(V7);
  });

  it('encodes the millisecond timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 5, 12, 0, 0, 123);
    const id = uuidv7(now);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('sorts by creation time across milliseconds and is unique', () => {
    const ids = [uuidv7(1_000), uuidv7(2_000), uuidv7(3_000)];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});
