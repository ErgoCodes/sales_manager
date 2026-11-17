import type { NextConfig } from 'next';

// Conservative baseline. The Content-Security-Policy (per-request nonce) is set by
// src/proxy.ts, because a nonce cannot be a static header.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

// Hosts (not full origins) that may submit Server Actions besides the app's own host.
// Explicit on purpose (ADR 0004); the same APP_ORIGINS feeds the Route Handler CSRF check.
const actionHosts = (process.env.APP_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .flatMap((origin) => {
    try {
      return [new URL(origin.trim()).host];
    } catch {
      return [];
    }
  });

const nextConfig: NextConfig = {
  experimental: { serverActions: { allowedOrigins: actionHosts } },
  poweredByHeader: false,
  reactStrictMode: true,
  // cacheComponents / partialPrefetching are off: a nonce-based CSP needs every page rendered per request,
  // and a prerendered static shell would ship scripts without the nonce (Next CSP guide).
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
