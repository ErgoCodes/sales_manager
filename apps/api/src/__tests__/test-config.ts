import type { AppConfig } from '../config/env';
import { generateSigningJwk } from '../config/signing-keys';

/** Shared by unit and integration tests: a valid config with an ephemeral signing key (never a committed one). */
export const TEST_IP_SECRET = 'test-client-ip-secret-at-least-32-characters';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    CORS_ORIGINS: ['http://localhost:3000'],
    LOG_LEVEL: 'silent',
    APP_VERSION: '9.9.9-test',
    JWT_PRIVATE_JWK: generateSigningJwk('test-current').privateJwk,
    JWT_ISSUER: 'monaco-api',
    JWT_AUDIENCE: 'monaco',
    CLIENT_IP_HMAC_SECRET: TEST_IP_SECRET,
    ...overrides,
  };
}
