import { randomBytes } from 'node:crypto';

import { hash, type Options, verify } from '@node-rs/argon2';

import type { PasswordHasher } from '../domain/auth-ports';

/**
 * argon2id with the OWASP Password Storage parameters: m = 19 MiB, t = 2, p = 1.
 * The parameters travel inside each PHC string, so raising them later only
 * affects new hashes.
 */
export const ARGON2_OPTIONS: Options = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export class Argon2PasswordHasher implements PasswordHasher {
  private dummy?: Promise<string>;

  constructor(private readonly options: Options = ARGON2_OPTIONS) {}

  hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash is a failed login, not a 500.
      return false;
    }
  }

  /**
   * Burns the same time as a real verification when the email does not exist,
   * against a hash of a random secret made once with the same parameters.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummy ??= hash(randomBytes(32).toString('base64url'), this.options);
    await this.verify(await this.dummy, password);
  }
}
