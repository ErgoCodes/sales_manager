import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared store of @nestjs/throttler (SP2·T3, ADR 0004). Not tenant-scoped:
 * login and refresh are throttled before any tenant is known. RLS is enabled
 * and forced with no policy at all, and monaco_app has no privilege on it: the
 * only way in is the SECURITY DEFINER function `rate_limit_hit` (migration
 * 0006), owned by monaco_auth. Keys are SHA-256 digests built by the guard, so
 * no IP or email is stored in clear.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  hits: integer('hits').notNull(),
  windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }).notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  // Consecutive blocks; each one doubles the next block (progressive backoff).
  strikes: integer('strikes').notNull().default(0),
  // When `strikes` resets to 0 (24 h after the last block ended).
  strikesExpireAt: timestamp('strikes_expire_at', { withTimezone: true }),
}).enableRLS();
