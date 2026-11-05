import { randomUUID } from 'node:crypto';

import { type CryptoKey, importJWK, type JWK, jwtVerify, type JWTVerifyGetKey, SignJWT } from 'jose';

import type { AccessTokenClaims, AccessTokenService } from '../domain/auth-ports';

export interface AccessTokenKeys {
  /** Current signing key (private JWK with kid). */
  readonly current: JWK & { kid: string; d: string };
  /** Previous key's public half, accepted for verification only (rotation). */
  readonly previous?: JWK & { kid: string };
}

export interface AccessTokenOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}

/** JWT `typ` of access tokens (RFC 9068), checked on verification. */
export const ACCESS_TOKEN_TYP = 'at+jwt';
const ALGORITHM = 'EdDSA';
const CLOCK_TOLERANCE_SECONDS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicHalf = ({ kty, crv, x, kid }: JWK & { kid: string }): JWK => ({ kty, crv, x, kid });

/**
 * EdDSA (Ed25519) access tokens with `jose` (ADR 0004). Verification pins the
 * algorithm, `typ`, `iss` and `aud`, allows 30 s of clock skew, and resolves
 * `kid` only against the local key set: `jku`, `x5u` and `jwk` headers are
 * never followed (jose does not fetch them and the resolver ignores them).
 */
export class JoseAccessTokenService implements AccessTokenService {
  private readonly signingKey: Promise<CryptoKey>;
  private readonly verificationKeys: Map<string, Promise<CryptoKey>>;

  constructor(
    private readonly keys: AccessTokenKeys,
    private readonly options: AccessTokenOptions,
  ) {
    this.signingKey = importJWK(keys.current, ALGORITHM) as Promise<CryptoKey>;
    this.verificationKeys = new Map(
      [keys.current, ...(keys.previous ? [keys.previous] : [])].map((key) => [key.kid, importJWK(publicHalf(key), ALGORITHM) as Promise<CryptoKey>]),
    );
  }

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({ tid: claims.tid, did: claims.did, sid: claims.sid })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.keys.current.kid, typ: ACCESS_TOKEN_TYP })
      .setSubject(claims.sub)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.options.ttlSeconds}s`)
      .setJti(randomUUID())
      .sign(await this.signingKey);
    return { token, expiresIn: this.options.ttlSeconds };
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    const resolveKey: JWTVerifyGetKey = (header) => {
      const key = header.kid === undefined ? undefined : this.verificationKeys.get(header.kid);
      if (!key) throw new Error('Unknown kid');
      return key;
    };
    try {
      const { payload } = await jwtVerify(token, resolveKey, {
        algorithms: [ALGORITHM],
        typ: ACCESS_TOKEN_TYP,
        issuer: this.options.issuer,
        audience: this.options.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'tid', 'did', 'sid', 'iat', 'exp'],
      });
      const { sub, tid, did, sid } = payload as Record<string, unknown>;
      if (![sub, tid, did, sid].every((value) => typeof value === 'string' && UUID.test(value))) return null;
      return { sub, tid, did, sid } as AccessTokenClaims;
    } catch {
      return null;
    }
  }
}
