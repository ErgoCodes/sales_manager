import { defineConfig, devices } from '@playwright/test';
import { loadRuntime } from './e2e/support/runtime';

// The stack (database, seed, secrets, web build) is prepared by e2e/prepare.mjs. The servers below are the
// real API and the production web build: same CSP, CSRF checks, rate limits and Secure `__Host-` cookies as
// in production. Chromium treats http://localhost as a secure context, so those cookies work without HTTPS.
const rt = loadRuntime();

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One shared database and one rate-limit counter: the specs run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: rt.webOrigin, trace: 'retain-on-failure', locale: 'es' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      cwd: __dirname,
      url: `${rt.apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        PORT: rt.apiPort,
        DATABASE_URL: rt.databaseUrl,
        CORS_ORIGINS: rt.webOrigin,
        JWT_PRIVATE_JWK: rt.jwtPrivateJwk,
        CLIENT_IP_HMAC_SECRET: rt.clientIpHmacSecret,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm exec next start --port ${rt.webPort}`,
      cwd: __dirname,
      url: `${rt.webOrigin}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        API_URL: rt.apiUrl,
        CLIENT_IP_HMAC_SECRET: rt.clientIpHmacSecret,
        APP_ORIGINS: rt.webOrigin,
      },
    },
  ],
});
