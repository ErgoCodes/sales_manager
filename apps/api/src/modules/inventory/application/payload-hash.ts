import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level; arrays keep their order (line order is content). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * SHA-256 of the command body as the client sent it (idempotency, ADR 0006 §4).
 * It runs on the validated body *before* the server applies defaults such as
 * `occurredAt = now`, so a retry without `occurredAt` still matches. The kind is
 * part of the content: the same id cannot be an entry once and an exit later.
 */
export function payloadHash(kind: string, body: object): string {
  return createHash('sha256').update(canonical({ kind, body })).digest('hex');
}
