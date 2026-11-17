/**
 * UUIDv7 (RFC 9562 §5.7): 48-bit Unix time in milliseconds, then version,
 * random bits and variant. Primary keys are generated in the application (and,
 * for inventory documents, by the client) because Postgres 17 has no native
 * uuidv7(). Uses `globalThis.crypto` so it runs in Node, browsers and React Native.
 * Ordering inside the same millisecond is random: never use the id as a strict sequence.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // 48-bit big-endian timestamp (Number math: bit operators would truncate to 32 bits).
  let t = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
