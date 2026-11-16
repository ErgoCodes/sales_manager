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
 * The browser's IP as seen by this server, given how many trusted proxies sit in front of it.
 * `x-forwarded-for` is a list each proxy appends to, so only the entries added by OUR proxies
 * can be trusted: the client controls everything to the left. We take the hop `trustedHops`
 * positions from the right (1 = the address our nearest proxy saw). The first hop is never
 * trusted by position, because a client can forge it behind an edge that appends.
 *
 * `trustedHops = 0` (the default) trusts no forwarded header at all: the result is null, the
 * signed header is omitted and the API falls back to the socket peer (the BFF itself).
 * Safe, but rate limits then key on the BFF's address; set TRUSTED_PROXY_HOPS to fix that.
 * `x-real-ip` is used only when hops are trusted and there is no `x-forwarded-for`.
 */
export function clientIpFromHeaders(headers: Headers, trustedHops = 0): string | null {
  if (!Number.isInteger(trustedHops) || trustedHops < 1) return null;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const chain = forwarded.split(',');
    const entry = chain.length >= trustedHops ? chain[chain.length - trustedHops] : undefined;
    return entry === undefined ? null : normalize(entry);
  }
  const real = headers.get('x-real-ip');
  return real ? normalize(real) : null;
}
