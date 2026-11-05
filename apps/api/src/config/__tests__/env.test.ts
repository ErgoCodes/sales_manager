import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadConfig } from '../env';
import { generateSigningJwk } from '../signing-keys';

const { privateJwk, publicJwk } = generateSigningJwk('current');
const previous = generateSigningJwk('previous').publicJwk;

const valid = {
  DATABASE_URL: 'postgres://user:secret@localhost:5432/monaco',
  CORS_ORIGINS: 'http://localhost:3000, https://app.example.com',
  JWT_PRIVATE_JWK: JSON.stringify(privateJwk),
};

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(loadConfig(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
      CORS_ORIGINS: ['http://localhost:3000', 'https://app.example.com'],
      LOG_LEVEL: 'info',
      APP_VERSION: '0.1.0',
      JWT_PRIVATE_JWK: privateJwk,
      JWT_ISSUER: 'monaco-api',
      JWT_AUDIENCE: 'monaco',
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadConfig({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast listing every missing variable', () => {
    expect(() => loadConfig({})).toThrow(InvalidEnvironmentError);
    try {
      loadConfig({});
    } catch (error) {
      const { issues } = error as InvalidEnvironmentError;
      expect(issues.some((issue) => issue.startsWith('DATABASE_URL'))).toBe(true);
      expect(issues.some((issue) => issue.startsWith('CORS_ORIGINS'))).toBe(true);
    }
  });

  it('never echoes values (they may be secrets) in the error', () => {
    const env = { ...valid, DATABASE_URL: 'mysql://user:hunter2@db/monaco' };
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(env)).not.toThrow(/hunter2/);
  });

  it.each([
    ['*'],
    ['http://localhost:3000/'],
    ['https://app.example.com/path'],
    ['ftp://files.example.com'],
    [' , '],
  ])('rejects CORS_ORIGINS=%j', (origins) => {
    expect(() => loadConfig({ ...valid, CORS_ORIGINS: origins })).toThrow(/CORS_ORIGINS/);
  });

  it.each([['0'], ['65536'], ['abc']])('rejects PORT=%j', (port) => {
    expect(() => loadConfig({ ...valid, PORT: port })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('accepts the previous public key for rotation and the client IP secret', () => {
    const config = loadConfig({ ...valid, JWT_PREVIOUS_PUBLIC_JWK: JSON.stringify(previous), CLIENT_IP_HMAC_SECRET: 'x'.repeat(32) });
    expect(config.JWT_PREVIOUS_PUBLIC_JWK).toEqual(previous);
    expect(config.CLIENT_IP_HMAC_SECRET).toHaveLength(32);
  });

  it.each([
    ['not JSON', 'not-json'],
    ['a public key', JSON.stringify(publicJwk)],
    ['an RSA key', JSON.stringify({ ...privateJwk, kty: 'RSA' })],
    ['a key without kid', JSON.stringify({ ...privateJwk, kid: undefined })],
    ['a key with extra members', JSON.stringify({ ...privateJwk, jku: 'https://evil.example/jwks' })],
  ])('rejects JWT_PRIVATE_JWK that is %s, without echoing it', (_label, value) => {
    expect(() => loadConfig({ ...valid, JWT_PRIVATE_JWK: value })).toThrow(/JWT_PRIVATE_JWK/);
    expect(() => loadConfig({ ...valid, JWT_PRIVATE_JWK: value })).not.toThrow(privateJwk.d);
  });

  it('rejects a previous key that is private or reuses the current kid', () => {
    expect(() => loadConfig({ ...valid, JWT_PREVIOUS_PUBLIC_JWK: JSON.stringify(privateJwk) })).toThrow(/JWT_PREVIOUS_PUBLIC_JWK/);
    expect(() => loadConfig({ ...valid, JWT_PREVIOUS_PUBLIC_JWK: JSON.stringify(publicJwk) })).toThrow(/kid must differ/);
  });

  it('requires a 32+ character CLIENT_IP_HMAC_SECRET in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/CLIENT_IP_HMAC_SECRET: Required in production/);
    expect(() => loadConfig({ ...valid, CLIENT_IP_HMAC_SECRET: 'short' })).toThrow(/CLIENT_IP_HMAC_SECRET/);
    // The empty placeholder of .env.example means "not set".
    expect(loadConfig({ ...valid, CLIENT_IP_HMAC_SECRET: '' }).CLIENT_IP_HMAC_SECRET).toBeUndefined();
    expect(loadConfig({ ...valid, NODE_ENV: 'production', CLIENT_IP_HMAC_SECRET: 's'.repeat(32) }).NODE_ENV).toBe('production');
  });
});
