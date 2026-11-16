import { describe, expect, it } from 'vitest';
import { buildCsp } from '../csp';

describe('buildCsp', () => {
  it('uses the nonce with strict-dynamic and no unsafe-eval in production', () => {
    const csp = buildCsp('abc123', false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('adds unsafe-eval only in development', () => {
    expect(buildCsp('n', true)).toContain("'unsafe-eval'");
  });
  it('is a single line', () => {
    expect(buildCsp('n', false)).not.toMatch(/\n/);
  });
});
