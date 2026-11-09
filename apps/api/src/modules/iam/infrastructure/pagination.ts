import type { Paginated } from '@monaco/contracts';

import { InvalidCursor } from '../domain/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** What one cursor position may hold: ids and timestamps only (they end up as SQL parameters). */
export type CursorPart = 'uuid' | 'timestamp';

/** Opaque cursor: base64url of a JSON array with the sort key of the last row of the page. */
export function encodeCursor(values: readonly string[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

/** Decodes a cursor this API issued, or throws `InvalidCursor` (400). Undefined means "first page". */
export function decodeCursor(cursor: string | undefined, parts: readonly CursorPart[]): string[] | undefined {
  if (cursor === undefined) return undefined;
  let values: unknown;
  try {
    values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursor();
  }
  const valid =
    Array.isArray(values) &&
    values.length === parts.length &&
    values.every((value, i) => typeof value === 'string' && (parts[i] === 'uuid' ? UUID : ISO).test(value));
  if (!valid) throw new InvalidCursor();
  return values as string[];
}

/** Repositories fetch `limit + 1` rows: the extra one only says whether there is a next page. */
export function toPage<T>(rows: readonly T[], limit: number, keyOf: (last: T) => readonly string[]): Paginated<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null };
}
