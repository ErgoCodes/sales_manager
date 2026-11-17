import { describe, expect, it } from 'vitest';

import { InvalidCursor } from '../../domain/errors';
import { decodeCursor, encodeCursor, toPage } from '../pagination';

const ID = '0190a000-0000-7000-8000-000000000001';
const AT = '2026-11-05T12:00:00.123456Z';

describe('cursors', () => {
  it('round-trips ids and timestamps', () => {
    expect(decodeCursor(encodeCursor([AT, ID]), ['timestamp', 'uuid'])).toEqual([AT, ID]);
    expect(decodeCursor(undefined, ['uuid'])).toBeUndefined();
  });

  it.each([
    ['not base64 JSON', 'not-a-cursor'],
    ['not an array', encodeCursor([]).replace(/.*/, Buffer.from('{"a":1}').toString('base64url'))],
    ['wrong arity', encodeCursor([ID, ID])],
    ['not a uuid', encodeCursor(["1' or 1=1"])],
    ['a number', Buffer.from('[1]').toString('base64url')],
  ])('rejects a forged cursor (%s) with InvalidCursor', (_label, cursor) => {
    expect(() => decodeCursor(cursor, ['uuid'])).toThrow(InvalidCursor);
  });

  it('rejects a timestamp that is not ISO', () => {
    expect(() => decodeCursor(encodeCursor(['yesterday', ID]), ['timestamp', 'uuid'])).toThrow(InvalidCursor);
  });
});

describe('toPage', () => {
  it('cuts the extra row and points the cursor at the last item', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, (last) => [last.id]);
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toEqual(['b']);
  });

  it('has no next page when the rows fit', () => {
    expect(toPage([{ id: 'a' }], 2, (last) => [last.id])).toEqual({ items: [{ id: 'a' }], nextCursor: null });
    expect(toPage([], 2, () => [])).toEqual({ items: [], nextCursor: null });
  });
});
