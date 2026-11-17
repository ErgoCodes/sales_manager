import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders, signClientIp } from '../client-ip';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('signClientIp', () => {
  // Known answers produced by signClientIp in apps/api (src/common/http/client-ip.ts):
  // the BFF and the API must agree byte for byte.
  it('matches the API algorithm (IPv4, method upper-cased)', () => {
    expect(signClientIp({ secret: SECRET, ip: '203.0.113.7', method: 'post', path: '/auth/login', timestamp: 1760000000 })).toBe(
      'v1;203.0.113.7;1760000000;9xAsexnGjccGz6a1Zz-1L91jmaeAmOHLSeQtVO8J1Bc',
    );
  });

  it('matches the API algorithm (IPv6)', () => {
    expect(signClientIp({ secret: SECRET, ip: '2001:db8::1', method: 'GET', path: '/me', timestamp: 1760000000 })).toBe(
      'v1;2001:db8::1;1760000000;BGEfaIHZFvmq8Qz6yDZNvVFY3mSuu82gwD1bEF68-Tg',
    );
  });
});

describe('clientIpFromHeaders', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('trusts nothing by default (0 hops): forwarded headers are ignored', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '198.51.100.10' }))).toBeNull();
  });
  it('ignores a forged first hop: takes the hop N positions from the right', () => {
    const headers = h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9' });
    expect(clientIpFromHeaders(headers, 1)).toBe('198.51.100.9');
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9, 10.0.0.1' }), 2)).toBe('198.51.100.9');
  });
  it('returns null when the chain is shorter than the trusted hops', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.9' }), 2)).toBeNull();
  });
  it('falls back to x-real-ip only when hops are trusted and there is no x-forwarded-for', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.10' }), 1)).toBe('198.51.100.10');
    expect(clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.10' }), 0)).toBeNull();
  });
  it('normalizes IPv4-mapped IPv6', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '::ffff:198.51.100.11' }), 1)).toBe('198.51.100.11');
  });
  it('returns null for missing or invalid values', () => {
    expect(clientIpFromHeaders(h({}), 1)).toBeNull();
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': 'not-an-ip' }), 1)).toBeNull();
  });
});
