import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { type AuthSeed, createAuthApp, PASSWORD, seedAuth, signedIpHeader } from './auth-fixtures';
import { adminPool, resetTenants } from './helpers';

// SP4 · T7 (spec D12): TRUSTED_PROXY_HOPS is wired from the config to the middleware. The audited
// IP of a login shows which address the API resolved.

let admin: Pool;
let seed: AuthSeed;

async function loginIp(app: NestExpressApplication, headers: Record<string, string>): Promise<string | null> {
  const req = request(app.getHttpServer()).post('/auth/login');
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  await req.send({ email: seed.owner.email, password: PASSWORD }).expect(200);
  const { rows } = await admin.query<{ ip: string | null }>(
    `select host(ip) as ip from audit_events where type = 'login_succeeded' order by created_at desc, id desc limit 1`,
  );
  return rows[0]!.ip;
}

beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await resetTenants(admin);
  await admin.end();
});
beforeEach(async () => {
  await resetTenants(admin);
  await admin.query('truncate table rate_limits');
  seed = await seedAuth(admin);
});

describe('client IP behind trusted proxies', () => {
  it('TRUSTED_PROXY_HOPS=1: the rightmost X-Forwarded-For entry, never the spoofed left ones; the signed header wins', async () => {
    const app = await createAuthApp([], { TRUSTED_PROXY_HOPS: 1 });
    try {
      expect(await loginIp(app, { 'x-forwarded-for': '6.6.6.6, 198.51.100.77' })).toBe('198.51.100.77');
      expect(
        await loginIp(app, { 'x-forwarded-for': '198.51.100.77', [CLIENT_IP_HEADER]: signedIpHeader('POST', '/auth/login', '203.0.113.50') }),
      ).toBe('203.0.113.50');
    } finally {
      await app.close();
    }
  });

  it('TRUSTED_PROXY_HOPS=0 (default): X-Forwarded-For is ignored, the socket address is used', async () => {
    const app = await createAuthApp();
    try {
      expect(await loginIp(app, { 'x-forwarded-for': '198.51.100.77' })).toBe('127.0.0.1');
    } finally {
      await app.close();
    }
  });
});
