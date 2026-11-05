import { createHash, randomBytes } from 'node:crypto';

import type { RefreshTokenCodec } from '../domain/auth-ports';

/** 32 random bytes, base64url. The database only ever sees their SHA-256. */
export class Sha256RefreshTokenCodec implements RefreshTokenCodec {
  generate(): { token: string; hash: Uint8Array } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): Uint8Array {
    return createHash('sha256').update(token, 'utf8').digest();
  }
}
