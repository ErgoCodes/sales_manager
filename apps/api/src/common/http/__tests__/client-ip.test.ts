import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { CLIENT_IP_HEADER, clientIpMiddleware, forwardedClientIp, normalizeIp, signClientIp, verifySignedClientIp } from '../client-ip';

const SECRET = 's'.repeat(32);
const NOW = 1_793_000_000_000;
const TS = NOW / 1000;
const sign = (overrides: Partial<Parameters<typeof signClientIp>[0]> = {}) =>
  signClientIp({ secret: SECRET, ip: '203.0.113.7', method: 'POST', path: '/auth/login', timestamp: TS, ...overrides });
const verify = (header: string | undefined, overrides: Partial<Parameters<typeof verifySignedClientIp>[1]> = {}) =>
  verifySignedClientIp(header, { secret: SECRET, method: 'POST', path: '/auth/login', now: NOW, ...overrides });

describe('signed client IP', () => {
  it('accepts a valid signature within the time window, for IPv4 and IPv6', () => {
    expect(verify(sign())).toBe('203.0.113.7');
    expect(verify(sign({ ip: '2001:db8::1' }))).toBe('2001:db8::1');
    expect(verify(sign({ timestamp: TS - 30 }))).toBe('203.0.113.7');
    expect(verify(sign(), { method: 'post' })).toBe('203.0.113.7');
  });

  it.each([
    ['no secret configured', sign(), { secret: undefined }],
    ['a missing header', undefined, {}],
    ['an oversized header', `v1;${'1'.repeat(300)}`, {}],
    ['a wrong number of parts', 'v1;203.0.113.7;123', {}],
    ['an unknown version', sign().replace(/^v1/, 'v2'), {}],
    ['an invalid IP', sign({ ip: 'not-an-ip' }), {}],
    ['a non-numeric timestamp', sign().replace(`;${TS};`, ';soon;'), {}],
    ['a stale timestamp (replay)', sign({ timestamp: TS - 31 }), {}],
    ['a future timestamp', sign({ timestamp: TS + 31 }), {}],
    ['another secret', sign({ secret: 't'.repeat(32) }), {}],
    ['another endpoint', sign({ path: '/auth/refresh' }), {}],
    ['another method', sign({ method: 'GET' }), {}],
    ['a tampered IP', sign().replace('203.0.113.7', '203.0.113.8'), {}],
    ['a truncated signature', sign().slice(0, -4), {}],
  ])('ignores %s', (_label, header, overrides) => {
    expect(verify(header, overrides)).toBeNull();
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp('::ffff:abcd')).toBe('::ffff:abcd');
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe('clientIpMiddleware', () => {
  const run = (headers: Record<string, string | string[]>, originalUrl = '/auth/login?x=1', trustedProxyHops = 0) => {
    const req = { headers, method: 'POST', originalUrl, socket: { remoteAddress: '::ffff:127.0.0.1' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    clientIpMiddleware(SECRET, { trustedProxyHops, now: () => NOW })(req, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    return req.clientIp;
  };

  it('uses the signed IP (path without query string)', () => {
    expect(run({ [CLIENT_IP_HEADER]: sign() })).toBe('203.0.113.7');
    expect(run({ [CLIENT_IP_HEADER]: sign() }, '/auth/login')).toBe('203.0.113.7');
  });

  it('with TRUSTED_PROXY_HOPS=0 falls back to the socket address, never X-Forwarded-For', () => {
    expect(run({ 'x-forwarded-for': '198.51.100.1' })).toBe('127.0.0.1');
    expect(run({ 'x-forwarded-for': '198.51.100.1, 198.51.100.2' })).toBe('127.0.0.1');
    expect(run({ [CLIENT_IP_HEADER]: [sign(), sign()] })).toBe('127.0.0.1');
  });

  it('behind trusted proxies takes the X-Forwarded-For entry counted from the right', () => {
    expect(run({ 'x-forwarded-for': '198.51.100.9' }, '/auth/login', 1)).toBe('198.51.100.9');
    // The client forged the left entries; only the one our proxy appended counts.
    expect(run({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 198.51.100.9' }, '/auth/login', 1)).toBe('198.51.100.9');
    expect(run({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9, 10.0.0.2' }, '/auth/login', 2)).toBe('198.51.100.9');
  });

  it('the signed header wins over X-Forwarded-For', () => {
    expect(run({ [CLIENT_IP_HEADER]: sign(), 'x-forwarded-for': '198.51.100.9' }, '/auth/login', 1)).toBe('203.0.113.7');
    // An invalid signature is ignored, so the forwarded entry is used.
    expect(run({ [CLIENT_IP_HEADER]: sign({ secret: 't'.repeat(32) }), 'x-forwarded-for': '198.51.100.9' }, '/auth/login', 1)).toBe('198.51.100.9');
  });

  it('falls back to the socket when the forwarded chain is missing, short or malformed', () => {
    expect(run({}, '/auth/login', 1)).toBe('127.0.0.1');
    expect(run({ 'x-forwarded-for': '198.51.100.9' }, '/auth/login', 2)).toBe('127.0.0.1');
    expect(run({ 'x-forwarded-for': '198.51.100.9, garbage' }, '/auth/login', 1)).toBe('127.0.0.1');
  });


  it('defaults to the real clock and no trusted proxies', () => {
    const req = { headers: { 'x-forwarded-for': '198.51.100.9' }, method: 'GET', originalUrl: '/', socket: {} } as unknown as Request;
    clientIpMiddleware(undefined)(req, {} as Response, vi.fn());
    expect(req.clientIp).toBeNull();
  });
});

describe('forwardedClientIp', () => {
  it.each([
    ['one hop, one entry', '203.0.113.1', 1, '203.0.113.1'],
    ['one hop ignores spoofed left entries', '1.1.1.1, 2.2.2.2, 203.0.113.1', 1, '203.0.113.1'],
    ['two hops', '1.1.1.1, 203.0.113.1, 10.0.0.1', 2, '203.0.113.1'],
    ['hops equal to the chain length', '203.0.113.1, 10.0.0.1', 2, '203.0.113.1'],
    ['whitespace around entries', ' 1.1.1.1 ,  203.0.113.1  ', 1, '203.0.113.1'],
    ['IPv6', '1.1.1.1, 2001:db8::5', 1, '2001:db8::5'],
    ['IPv4-mapped IPv6 is normalized', '::ffff:203.0.113.1', 1, '203.0.113.1'],
  ])('%s', (_label, header, hops, expected) => {
    expect(forwardedClientIp(header, hops)).toBe(expected);
  });

  it.each([
    ['zero hops', '203.0.113.1', 0],
    ['negative hops', '203.0.113.1', -1],
    ['fractional hops', '203.0.113.1', 1.5],
    ['no header', undefined, 1],
    ['an empty header', '', 1],
    ['more hops than entries (never the attacker-controlled left entry)', '203.0.113.1', 2],
    ['a malformed entry at the trusted position', '203.0.113.1, not-an-ip', 1],
    ['an empty entry at the trusted position', '203.0.113.1,', 1],
    ['an entry with a port', '203.0.113.1:4321', 1],
    ['an array (duplicate headers are joined by Node, so this is unexpected)', ['203.0.113.1'], 1],
  ])('returns null for %s', (_label, header, hops) => {
    expect(forwardedClientIp(header as string | undefined, hops)).toBeNull();
  });
});
