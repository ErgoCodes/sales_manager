import { randomBytes } from 'node:crypto';

import { generateSigningJwk } from '../config/signing-keys';

/**
 * `pnpm --filter api keys:generate`: prints development secrets to paste into
 * apps/api/.env (and the HMAC secret into apps/web/.env.local). Nothing is
 * written to disk, so no key can end up committed. To rotate: move the current
 * key's public half to JWT_PREVIOUS_PUBLIC_JWK, then set the new private key.
 */
const { privateJwk, publicJwk } = generateSigningJwk();
console.log(`JWT_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`);
console.log(`# Public half (for JWT_PREVIOUS_PUBLIC_JWK on the next rotation):`);
console.log(`# ${JSON.stringify(publicJwk)}`);
console.log(`CLIENT_IP_HMAC_SECRET=${randomBytes(32).toString('base64url')}`);
