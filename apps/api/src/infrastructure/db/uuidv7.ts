import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562 §5.7): 48-bit Unix time in milliseconds, then version,
 * random bits and variant. Primary keys are generated here, in the
 * application, because Postgres 17 has no native uuidv7() (it arrives in 18)
 * and a PL/pgSQL default would be slower and diverge from it later. The time
 * prefix keeps B-tree inserts mostly sequential; ordering inside the same
 * millisecond is random, so never use the id as a strict sequence.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
