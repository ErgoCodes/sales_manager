import { isIP } from 'node:net';

import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';

import type { Database } from '../db/database';
import { DATABASE } from '../db/database.tokens';
import { PostgresThrottlerStorage } from './postgres-throttler.storage';

/**
 * Named throttlers (ADR 0004). They only run on routes that opt in with
 * `@UseGuards(ThrottlerGuard)` (login, refresh, password change; T4 adds
 * POST /users). Never keyed by email alone: a hard lock per email would let
 * anyone lock the owner out.
 *
 * - `ip`: per client IP (the signed one, see client-ip.ts).
 * - `credential`: per (client IP, identity): the login email, or the user of
 *   an authenticated request.
 */
export const RATE_LIMITS = {
  ip: { limit: 30, ttl: 60_000, blockDuration: 60_000 },
  credential: { limit: 5, ttl: 5 * 60_000, blockDuration: 60_000 },
  /** Cap of the progressive backoff (blocks double per consecutive violation). */
  maxBlockMs: 15 * 60_000,
} as const;

interface TrackedRequest {
  clientIp?: string | null;
  actor?: { userId: string };
  body?: unknown;
}

/**
 * The rate-limit subject of a client IP. An IPv6 client usually owns a whole
 * /64 and can rotate addresses inside it at will, so IPv6 is keyed by its /64
 * prefix (otherwise rotating defeats the limit and grows `rate_limits`). An
 * IPv4-mapped IPv6 address is keyed as its IPv4. Anything else is kept as is.
 */
export function rateLimitSubject(ip: string): string {
  const address = ip.split('%')[0]!.toLowerCase();
  if (isIP(address) !== 6) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1]!;
  const [head = '', tail] = address.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const left = groups(head);
  // A trailing dotted IPv4 (e.g. 64:ff9b::192.0.2.1) fills the last two groups;
  // only the first four groups matter here, so its value is irrelevant.
  const right = groups(tail ?? '').flatMap((group) => (group.includes('.') ? ['0', '0'] : [group]));
  const full = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  const prefix = full.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
  return `${prefix.join(':')}::/64`;
}

export function ipTracker(req: TrackedRequest): string {
  return `ip:${req.clientIp ? rateLimitSubject(req.clientIp) : 'unknown'}`;
}

export function credentialTracker(req: TrackedRequest): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  const identity = req.actor ? `user:${req.actor.userId}` : `email:${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
  return `${ipTracker(req)}|${identity}`;
}

const tracker = (fn: (req: TrackedRequest) => string) => (req: Record<string, unknown>, _context: ExecutionContext) => fn(req);

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) => ({
        storage: new PostgresThrottlerStorage(db, RATE_LIMITS.maxBlockMs),
        throttlers: [
          { name: 'ip', ...RATE_LIMITS.ip, getTracker: tracker(ipTracker) },
          { name: 'credential', ...RATE_LIMITS.credential, getTracker: tracker(credentialTracker) },
        ],
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
