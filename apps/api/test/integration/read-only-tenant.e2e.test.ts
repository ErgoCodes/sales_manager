import { AuthTokens, ErrorResponse, MeResponse, RefreshResponse } from '@monaco/contracts';
import { METHODS } from 'node:http';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLIENT_IP_HEADER } from '../../src/common/http/client-ip';
import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { AUTH_TENANT_A, type AuthSeed, createAuthApp, freshIp, PASSWORD, seedAuth, signedIpHeader } from './auth-fixtures';
import { adminPool, resetTenants } from './helpers';

// SP4 · T7 (spec D10): a tenant with read_only = true answers 403 DEMO_READ_ONLY to every
// mutation but login, refresh and logout. Deny by default: this test walks EVERY route the
// Nest app registers, so a new mutating route that is not blocked fails it.

/** The only mutations a read-only tenant may call. Adding to this list is a security decision (spec D10). */
const ALLOWED_MUTATIONS = new Set(['POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout']);

interface Route {
  method: string;
  path: string;
}

interface RouterLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Every route registered in the Express router of the Nest app (not a hand-written list).
 * Nest registers a `forRoutes({ method: ALL })` middleware (body parsers, client IP) as one
 * route per HTTP method in `http.METHODS`: those layers are middleware, not handlers, and are
 * skipped. A controller `@All()` route is registered as `_all` instead and is expanded to the
 * mutating methods, so it cannot hide.
 */
function registeredRoutes(app: NestExpressApplication): Route[] {
  const express = app.getHttpAdapter().getInstance() as { router: { stack: RouterLayer[] } };
  const routes: Route[] = [];
  for (const layer of express.router.stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route!.methods[m]);
    if (METHODS.every((m) => methods.includes(m.toLowerCase()))) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const path of paths) {
      for (const method of methods.flatMap((m) => (m === '_all' ? ['GET', ...MUTATING_METHODS] : [m.toUpperCase()]))) {
        routes.push({ method, path });
      }
    }
  }
  return routes;
}

/** A concrete URL for a route pattern: every `:param` becomes a well-formed UUIDv7. */
function concrete(path: string): string {
  if (/[*{}()]/.test(path)) throw new Error(`Route pattern not supported by this test, extend concrete(): ${path}`);
  return path.replace(/:[A-Za-z0-9_]+/g, () => uuidv7());
}

let app: NestExpressApplication;
let admin: Pool;
let seed: AuthSeed;
let tokens: AuthTokens;

const http = () => request(app.getHttpServer());

function call(method: string, path: string, token: string, body: object = {}) {
  const url = concrete(path);
  const verb = method.toLowerCase() as 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete' | 'options';
  const req = http()[verb](url).set('authorization', `Bearer ${token}`).set(CLIENT_IP_HEADER, signedIpHeader(method, url, freshIp()));
  return method === 'GET' || method === 'HEAD' ? req : req.send(body);
}

beforeAll(async () => {
  admin = adminPool();
  app = await createAuthApp();
  await resetTenants(admin);
  await admin.query('truncate table rate_limits');
  seed = await seedAuth(admin);
  // The demo tenant: read-only, and a pending (even expired) temporary password on the owner
  // that must neither be required nor block the login.
  await admin.query('update tenants set read_only = true where id = $1', [AUTH_TENANT_A]);
  await admin.query(`update users set must_change_password = true, password_expires_at = now() - interval '1 day' where id = $1`, [seed.owner.id]);
  const res = await http()
    .post('/auth/login')
    .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', freshIp()))
    .send({ email: seed.owner.email, password: PASSWORD })
    .expect(200);
  tokens = AuthTokens.parse(res.body);
});
afterAll(async () => {
  await app.close();
  await resetTenants(admin);
  await admin.end();
});

describe('read-only tenant (public demo)', () => {
  it('logs in without requiring a password change, and GET /me says so', async () => {
    expect(tokens.mustChangePassword).toBe(false);
    const me = MeResponse.parse((await call('GET', '/me', tokens.accessToken).expect(200)).body);
    expect(me.user.mustChangePassword).toBe(false);
    expect(me.tenant.id).toBe(AUTH_TENANT_A);
  });

  it('walks every registered route: 403 DEMO_READ_ONLY on each mutation, GET/HEAD are not blocked', async () => {
    const routes = registeredRoutes(app);
    // Sanity: the walk is not vacuous and sees the allow-listed routes themselves.
    expect(routes.length).toBeGreaterThan(30);
    const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const allowed of ALLOWED_MUTATIONS) expect(keys).toContain(allowed);
    expect(keys).toContain('POST /auth/password');

    const failures: string[] = [];
    let mutations = 0;
    let reads = 0;
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (ALLOWED_MUTATIONS.has(key)) continue;
      const res = await call(route.method, route.path, tokens.accessToken);
      if (route.method === 'GET' || route.method === 'HEAD') {
        reads += 1;
        // Not blocked: the handler ran (200), or rejected the made-up id/query (404/400).
        const code = (res.body as { error?: { code?: string } } | undefined)?.error?.code;
        if (![200, 400, 404].includes(res.status) || code === 'DEMO_READ_ONLY') failures.push(`${key} -> ${res.status} ${code ?? ''}`);
        continue;
      }
      mutations += 1;
      const parsed = ErrorResponse.safeParse(res.body);
      if (res.status !== 403 || !parsed.success || parsed.data.error.code !== 'DEMO_READ_ONLY') {
        failures.push(`${key} -> ${res.status} ${JSON.stringify(res.body)} (expected 403 DEMO_READ_ONLY)`);
      }
    }
    expect(failures).toEqual([]);
    expect(mutations).toBeGreaterThan(15);
    expect(reads).toBeGreaterThan(10);
  });

  it('HEAD is a read', async () => {
    await call('HEAD', '/me', tokens.accessToken).expect(200);
  });

  it('denies POST /auth/password, so nobody changes a published password', async () => {
    const res = await call('POST', '/auth/password', tokens.accessToken).expect(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('DEMO_READ_ONLY');
    const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from audit_events where type = 'password_changed'`);
    expect(rows[0]!.n).toBe(0);
  });

  it('a writable tenant is unaffected', async () => {
    const res = await http()
      .post('/auth/login')
      .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/login', freshIp()))
      .send({ email: seed.other.email, password: PASSWORD })
      .expect(200);
    const other = AuthTokens.parse(res.body);
    const created = await call('POST', '/locations', other.accessToken, { name: 'Norte', code: 'norte' });
    expect(created.status).toBe(201);
  });

  it('refresh and logout work (logout last: it ends the session)', async () => {
    const refreshed = RefreshResponse.parse(
      (
        await http()
          .post('/auth/refresh')
          .set(CLIENT_IP_HEADER, signedIpHeader('POST', '/auth/refresh', freshIp()))
          .send({ refreshToken: tokens.refreshToken })
          .expect(200)
      ).body,
    );
    await call('POST', '/auth/logout', refreshed.accessToken).expect(204);
    await call('GET', '/me', refreshed.accessToken).expect(401);
  });
});
