import 'server-only';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Signed client IP (ADR 0004 §7). Same algorithm as `signClientIp` in
 * apps/api/src/common/http/client-ip.ts: the two must agree byte for byte, and
 * a known-answer test pins that.
 *
 *   x-monaco-client-ip: v1;<ip>;<unix seconds>;<base64url HMAC-SHA256>
 *
 * The MAC covers `v1\n<ip>\n<ts>\n<METHOD>\n<path without query>`.
 */
export const CLIENT_IP_HEADER = 'x-monaco-client-ip';
const VERSION = 'v1';

export interface SignInput {
  secret: string;
  ip: string;
  method: string;
  path: string;
  /** Unix seconds. */
  timestamp: number;
}

export function signClientIp({ secret, ip, method, path, timestamp }: SignInput): string {
  const mac = createHmac('sha256', secret)
    .update(`${VERSION}\n${ip}\n${timestamp}\n${method.toUpperCase()}\n${path}`)
    .digest('base64url');
  return `${VERSION};${ip};${timestamp};${mac}`;
}

function normalize(ip: string): string | null {
  const value = ip.trim();
  const unmapped = value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  return isIP(unmapped) === 0 ? null : unmapped;
}

/**
 * The browser's IP as seen by this server: first `x-forwarded-for` hop, then
 * `x-real-ip`. The deployment edge must overwrite these headers (it must not
 * pass through a client-supplied value); the API then trusts only the signed
 * header, never `X-Forwarded-For`. Returns null when nothing valid is present,
 * in which case the header is omitted and the API falls back to the socket peer.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  const candidate = forwarded !== undefined ? normalize(forwarded) : null;
  if (candidate) return candidate;
  const real = headers.get('x-real-ip');
  return real ? normalize(real) : null;
}
