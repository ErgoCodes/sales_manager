import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { NextFunction, Request, Response } from 'express';

/**
 * Client IP (ADR 0004 §7). Behind the web BFF the API only sees the BFF's
 * address, so the BFF sends the real client IP in one signed header:
 *
 *   x-monaco-client-ip: v1;<ip>;<unix seconds>;<base64url HMAC-SHA256>
 *
 * The MAC covers `v1\n<ip>\n<ts>\n<METHOD>\n<path without query>` with the
 * shared CLIENT_IP_HMAC_SECRET. It is accepted only if the MAC matches
 * (constant-time compare) and the timestamp is within ±30 s, so a captured
 * header cannot be replayed later or on another endpoint. Anything else is
 * ignored.
 *
 * Without a valid signed header (mobile talks to the API directly), the IP
 * comes from `X-Forwarded-For` only when TRUSTED_PROXY_HOPS > 0 (SP4 · D12):
 * the entry that many positions from the right, the one our outermost trusted
 * proxy appended. With 0 (the default) the header is never read and the socket
 * address is used, exactly as before.
 */
export const CLIENT_IP_HEADER = 'x-monaco-client-ip';
export const CLIENT_IP_MAX_SKEW_SECONDS = 30;
const VERSION = 'v1';

declare module 'express-serve-static-core' {
  interface Request {
    /** Client IP: the signed header's if valid, else the trusted X-Forwarded-For hop (if configured), else the socket peer. */
    clientIp?: string | null;
  }
}

export interface SignInput {
  secret: string;
  ip: string;
  method: string;
  path: string;
  /** Unix seconds. */
  timestamp: number;
}

function mac({ secret, ip, method, path, timestamp }: SignInput): Buffer {
  return createHmac('sha256', secret).update(`${VERSION}\n${ip}\n${timestamp}\n${method.toUpperCase()}\n${path}`).digest();
}

/** Header value the BFF must send (also used by tests). */
export function signClientIp(input: SignInput): string {
  return `${VERSION};${input.ip};${input.timestamp};${mac(input).toString('base64url')}`;
}

/** The IP from a valid signed header, or null. */
export function verifySignedClientIp(
  header: string | undefined,
  context: { secret: string | undefined; method: string; path: string; now: number },
): string | null {
  if (!context.secret || !header || header.length > 200) return null;
  const parts = header.split(';');
  if (parts.length !== 4) return null;
  const [version, ip, ts, signature] = parts as [string, string, string, string];
  if (version !== VERSION || isIP(ip) === 0 || !/^\d{1,12}$/.test(ts)) return null;
  const timestamp = Number(ts);
  if (Math.abs(context.now / 1000 - timestamp) > CLIENT_IP_MAX_SKEW_SECONDS) return null;
  const expected = mac({ secret: context.secret, ip, method: context.method, path: context.path, timestamp });
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return ip;
}

/** `::ffff:10.0.0.1` -> `10.0.0.1`, so the same client always yields the same key. */
export function normalizeIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

/**
 * The client IP from `X-Forwarded-For` behind `trustedHops` proxies, or null.
 * Each proxy appends the address it saw, so only the rightmost `trustedHops`
 * entries were written by our proxies; everything to their left is whatever
 * the client sent. The entry `trustedHops` from the right is the address our
 * outermost proxy saw. A chain shorter than that, or a malformed entry at that
 * position, means the proxies are not as configured: null (socket fallback),
 * never a guess further left, where the client controls the value.
 */
export function forwardedClientIp(header: string | undefined, trustedHops: number): string | null {
  if (!Number.isInteger(trustedHops) || trustedHops < 1 || typeof header !== 'string') return null;
  const chain = header.split(',');
  if (chain.length < trustedHops) return null;
  const entry = chain[chain.length - trustedHops]!.trim();
  return isIP(entry) === 0 ? null : normalizeIp(entry);
}

function pathOf(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

export interface ClientIpOptions {
  /** Proxies in front of the API that append to `X-Forwarded-For` (TRUSTED_PROXY_HOPS). 0: never read it. */
  trustedProxyHops?: number;
  now?: () => number;
}

/** Express middleware that sets `req.clientIp` before any guard runs. */
export function clientIpMiddleware(secret: string | undefined, { trustedProxyHops = 0, now = Date.now }: ClientIpOptions = {}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers[CLIENT_IP_HEADER];
    const signed = verifySignedClientIp(typeof header === 'string' ? header : undefined, {
      secret,
      method: req.method,
      path: pathOf(req.originalUrl),
      now: now(),
    });
    const forwarded = req.headers['x-forwarded-for'];
    req.clientIp =
      signed ??
      forwardedClientIp(typeof forwarded === 'string' ? forwarded : undefined, trustedProxyHops) ??
      normalizeIp(req.socket.remoteAddress);
    next();
  };
}
