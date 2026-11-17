import { randomBytes } from 'node:crypto';

import type { TemporaryPasswordGenerator } from '../domain/user-admin-ports';

/** 18 random bytes as base64url: 24 characters, 144 bits (well over the 12-character minimum). */
export class RandomTemporaryPasswordGenerator implements TemporaryPasswordGenerator {
  generate(): string {
    return randomBytes(18).toString('base64url');
  }
}
