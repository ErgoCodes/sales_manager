import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, parseOrigins } from '../origin';

const ALLOWED = parseOrigins('https://app.example.com, http://localhost:3000');
const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers) });

describe('parseOrigins', () => {
  it('normalizes and drops invalid entries', () => {
    expect(parseOrigins('https://a.com/, nope, http://b.com:81')).toEqual(['https://a.com', 'http://b.com:81']);
  });
});

describe('isAllowedOrigin', () => {
  it('lets safe methods through without checks', () => {
    expect(isAllowedOrigin(req('GET', {}), ALLOWED)).toBe(true);
    expect(isAllowedOrigin(req('HEAD', { origin: 'https://evil.com' }), ALLOWED)).toBe(true);
  });
  it('accepts a mutating request from an allowed Origin', () => {
    expect(isAllowedOrigin(req('POST', { origin: 'https://app.example.com' }), ALLOWED)).toBe(true);
  });
  it('rejects a mutating request from another Origin even when Sec-Fetch-Site says same-origin', () => {
    expect(isAllowedOrigin(req('POST', { origin: 'https://evil.com', 'sec-fetch-site': 'same-origin' }), ALLOWED)).toBe(false);
  });
  it('rejects the opaque "null" Origin', () => {
    expect(isAllowedOrigin(req('DELETE', { origin: 'null' }), ALLOWED)).toBe(false);
  });
  it('without Origin, requires Sec-Fetch-Site same-origin or none', () => {
    expect(isAllowedOrigin(req('POST', { 'sec-fetch-site': 'same-origin' }), ALLOWED)).toBe(true);
    expect(isAllowedOrigin(req('POST', { 'sec-fetch-site': 'none' }), ALLOWED)).toBe(true);
    expect(isAllowedOrigin(req('POST', { 'sec-fetch-site': 'cross-site' }), ALLOWED)).toBe(false);
    expect(isAllowedOrigin(req('POST', { 'sec-fetch-site': 'same-site' }), ALLOWED)).toBe(false);
  });
  it('rejects a mutating request with neither Origin nor Sec-Fetch-Site', () => {
    expect(isAllowedOrigin(req('PUT', {}), ALLOWED)).toBe(false);
  });
  it('rejects a cross-site Sec-Fetch-Site even with an allowed Origin', () => {
    expect(isAllowedOrigin(req('POST', { origin: 'https://app.example.com', 'sec-fetch-site': 'cross-site' }), ALLOWED)).toBe(false);
  });
});
