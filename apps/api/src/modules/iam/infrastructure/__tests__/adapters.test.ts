import { generateKeyPairSync } from 'node:crypto';

import { decodeProtectedHeader, importJWK, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { generateSigningJwk } from '../../../../config/signing-keys';
import { ARGON2_OPTIONS, Argon2PasswordHasher } from '../argon2-password-hasher';
import { ACCESS_TOKEN_TYP, JoseAccessTokenService } from '../jose-access-token.service';
import { PgPreAuthLookup } from '../pg-pre-auth-lookup';
import { PinoSecurityLog } from '../pino-security-log';
import { Sha256RefreshTokenCodec } from '../sha256-refresh-token.codec';
import { systemClock } from '../system-clock';

const CLAIMS = {
  sub: '0190a000-0000-7000-8000-000000000001',
  tid: '0190a000-0000-7000-8000-000000000002',
  did: '0190a000-0000-7000-8000-000000000003',
  sid: '0190a000-0000-7000-8000-000000000004',
};
const OPTIONS = { issuer: 'monaco-api', audience: 'monaco', ttlSeconds: 600 };

describe('Argon2PasswordHasher', () => {
  it('uses argon2id with the OWASP parameters', async () => {
    expect(ARGON2_OPTIONS).toEqual({ algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const hash = await new Argon2PasswordHasher().hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies, rejects wrong passwords and malformed hashes, and burns a dummy verification', async () => {
    const hasher = new Argon2PasswordHasher({ ...ARGON2_OPTIONS, memoryCost: 1024, timeCost: 1 });
    const hash = await hasher.hash('correct horse battery');
    expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hash, 'wrong')).toBe(false);
    expect(await hasher.verify('not-a-phc-string', 'x')).toBe(false);
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
    await expect(hasher.verifyDummy('again')).resolves.toBeUndefined();
  });
});

describe('JoseAccessTokenService', () => {
  const { privateJwk, publicJwk } = generateSigningJwk('k1');
  const service = new JoseAccessTokenService({ current: privateJwk }, OPTIONS);

  it('issues EdDSA at+jwt tokens with kid, iss, aud, exp and the session claims', async () => {
    const { token, expiresIn } = await service.issue(CLAIMS);
    expect(expiresIn).toBe(600);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'EdDSA', kid: 'k1', typ: ACCESS_TOKEN_TYP });
    expect(await service.verify(token)).toEqual(CLAIMS);
  });

  it('accepts tokens of the previous key during a rotation, and only those', async () => {
    const old = new JoseAccessTokenService({ current: privateJwk }, OPTIONS);
    const next = generateSigningJwk('k2');
    const rotated = new JoseAccessTokenService({ current: next.privateJwk, previous: publicJwk }, OPTIONS);
    const { token } = await old.issue(CLAIMS);
    expect(await rotated.verify(token)).toEqual(CLAIMS);
    const stranger = new JoseAccessTokenService({ current: generateSigningJwk('k3').privateJwk }, OPTIONS);
    expect(await stranger.verify(token)).toBeNull();
  });

  const signWith = async (header: Record<string, unknown>, payload: Record<string, unknown>, opts: { exp?: string; iss?: string; aud?: string } = {}) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'EdDSA', ...header })
      .setIssuedAt()
      .setIssuer(opts.iss ?? 'monaco-api')
      .setAudience(opts.aud ?? 'monaco')
      .setExpirationTime(opts.exp ?? '10m')
      .setSubject(CLAIMS.sub)
      .sign(await importJWK(privateJwk, 'EdDSA'));

  it.each([
    ['a wrong typ', { kid: 'k1', typ: 'JWT' }, {}, {}],
    ['no kid', { typ: ACCESS_TOKEN_TYP }, {}, {}],
    ['an unknown kid', { kid: 'nope', typ: ACCESS_TOKEN_TYP }, {}, {}],
    ['another issuer', { kid: 'k1', typ: ACCESS_TOKEN_TYP }, {}, { iss: 'evil' }],
    ['another audience', { kid: 'k1', typ: ACCESS_TOKEN_TYP }, {}, { aud: 'evil' }],
    ['an expired token (beyond 30 s of skew)', { kid: 'k1', typ: ACCESS_TOKEN_TYP }, {}, { exp: '-31s' }],
    ['missing session claims', { kid: 'k1', typ: ACCESS_TOKEN_TYP }, { did: undefined, sid: undefined }, {}],
    ['non-UUID claims', { kid: 'k1', typ: ACCESS_TOKEN_TYP }, { tid: 'x', did: 'y', sid: 'z' }, {}],
    ['an embedded jwk header (ignored)', { kid: 'nope', typ: ACCESS_TOKEN_TYP, jwk: publicJwk }, {}, {}],
  ])('rejects %s', async (_label, header, payload, opts) => {
    const token = await signWith(header, { tid: CLAIMS.tid, did: CLAIMS.did, sid: CLAIMS.sid, ...payload }, opts);
    expect(await service.verify(token)).toBeNull();
  });

  it('tolerates up to 30 s of clock skew', async () => {
    const token = await signWith({ kid: 'k1', typ: ACCESS_TOKEN_TYP }, { tid: CLAIMS.tid, did: CLAIMS.did, sid: CLAIMS.sid }, { exp: '-20s' });
    expect(await service.verify(token)).toEqual(CLAIMS);
  });

  it('rejects other algorithms (alg confusion) and garbage', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const es256 = await new SignJWT({ tid: CLAIMS.tid, did: CLAIMS.did, sid: CLAIMS.sid })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: ACCESS_TOKEN_TYP })
      .setSubject(CLAIMS.sub)
      .setIssuer('monaco-api')
      .setAudience('monaco')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    expect(await service.verify(es256)).toBeNull();
    expect(await service.verify('garbage')).toBeNull();
  });
});

describe('small adapters', () => {
  it('Sha256RefreshTokenCodec generates 32 random bytes and stores only their SHA-256', () => {
    const codec = new Sha256RefreshTokenCodec();
    const { token, hash } = codec.generate();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toHaveLength(32);
    expect(codec.hash(token)).toEqual(hash);
    expect(codec.generate().token).not.toBe(token);
  });

  it('PinoSecurityLog logs unknown-email logins without the email', () => {
    const warn = vi.fn();
    new PinoSecurityLog({ warn }).loginWithUnknownEmail({ ip: '10.0.0.1' });
    expect(warn).toHaveBeenCalledWith({ event: 'login_unknown_email', ip: '10.0.0.1' }, expect.any(String));
  });

  it('systemClock reads the current time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });

  it('PgPreAuthLookup maps the SECURITY DEFINER rows', async () => {
    const execute = vi.fn();
    const lookup = new PgPreAuthLookup({ execute } as never);
    execute.mockResolvedValueOnce({ rows: [{ id: 'u', tenant_id: 't', password_hash: 'h', status: 'active' }] });
    expect(await lookup.findUserByEmail('a@b.co')).toEqual({ id: 'u', tenantId: 't', passwordHash: 'h', status: 'active' });
    execute.mockResolvedValueOnce({ rows: [] });
    expect(await lookup.findUserByEmail('a@b.co')).toBeNull();
    execute.mockResolvedValueOnce({ rows: [{ tenant_id: 't' }] });
    expect(await lookup.findRefreshTenant(new Uint8Array(32))).toEqual({ tenantId: 't' });
    execute.mockResolvedValueOnce({ rows: [] });
    expect(await lookup.findRefreshTenant(new Uint8Array(32))).toBeNull();
  });
});
