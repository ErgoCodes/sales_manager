import { generateKeyPairSync, randomBytes } from 'node:crypto';

import type { Ed25519PrivateJwk, Ed25519PublicJwk } from './env';

/**
 * Generates a fresh Ed25519 key pair as JWKs. Used by `keys:generate` (dev
 * keys, printed once, never committed), by the OpenAPI generator and by the
 * tests, which always run with ephemeral keys (ADR 0004).
 */
export function generateSigningJwk(kid = `k-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`): {
  privateJwk: Ed25519PrivateJwk;
  publicJwk: Ed25519PublicJwk;
} {
  const { privateKey } = generateKeyPairSync('ed25519');
  const { x, d } = privateKey.export({ format: 'jwk' });
  if (!x || !d) throw new Error('Ed25519 key export failed');
  const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x, kid, alg: 'EdDSA', use: 'sig' };
  return { privateJwk: { ...publicJwk, d }, publicJwk };
}
