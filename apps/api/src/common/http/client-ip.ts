import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { NextFunction, Request, Response } from 'express';

/**
 * Signed client IP (ADR 0004). Behind the web BFF the API only sees the BFF's
 * address, and `X-Forwarded-For` can be forged by anyone, so it is never read.
 * The BFF sends the real client IP in one header:
 *
 *   x-monaco-client-ip: v1;<ip>;<unix seconds>;<base64url HMAC-SHA256>
 *
 * The MAC covers `v1\n<ip>\n<ts>\n<METHOD>\n<path without query>` with the
 * shared CLIENT_IP_HMAC_SECRET. It is accepted only if the MAC matches
 * (constant-time compare) and the timestamp is within ±30 s, so a captured
 * header cannot be replayed later or on another endpoint. Anything else is
 * ignored and the socket address is used instead.
 */
export const CLIENT_IP_HEADER = 'x-monaco-client-ip';
export const CLIENT_IP_MAX_SKEW_SECONDS = 30;
const VERSION = 'v1';

declare module 'express-serve-static-core' {
  interface Request {
    /** Client IP: the signed header's if valid, otherwise the socket peer. Never X-Forwarded-For. */
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

function pathOf(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/** Express middleware that sets `req.clientIp` before any guard runs. */
export function clientIpMiddleware(secret: string | undefined, now: () => number = Date.now) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers[CLIENT_IP_HEADER];
    const signed = verifySignedClientIp(typeof header === 'string' ? header : undefined, {
      secret,
      method: req.method,
      path: pathOf(req.originalUrl),
      now: now(),
    });
    req.clientIp = signed ?? normalizeIp(req.socket.remoteAddress);
    next();
  };
}
