import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { PostgresThrottlerStorage } from '../postgres-throttler.storage';
import { credentialTracker, ipTracker, RATE_LIMITS } from '../rate-limit.module';

describe('PostgresThrottlerStorage', () => {
  const dialect = new PgDialect();

  it('calls rate_limit_hit and converts milliseconds to the seconds the throttler expects', async () => {
    const execute = vi.fn(async (_query: SQL) => ({
      rows: [{ total_hits: 6, time_to_expire_ms: '1500', is_blocked: true, time_to_block_expire_ms: 60_000 }],
    }));
    const storage = new PostgresThrottlerStorage({ execute } as never, 900_000);
    expect(await storage.increment('key', 60_000.4, 5, 60_000)).toEqual({ totalHits: 6, timeToExpire: 2, isBlocked: true, timeToBlockExpire: 60 });
    expect(dialect.sqlToQuery(execute.mock.calls[0]![0]).params).toEqual(['key', 60_000, 5, 60_000, 900_000]);

    await storage.increment('key', 1_000, 5, -1);
    expect(dialect.sqlToQuery(execute.mock.calls[1]![0]).params).toEqual(['key', 1_000, 5, 0, 900_000]);
  });

  it('never passes a cap below the block duration', async () => {
    const execute = vi.fn(async () => ({ rows: [{ total_hits: 1, time_to_expire_ms: 0, is_blocked: false, time_to_block_expire_ms: 0 }] }));
    await new PostgresThrottlerStorage({ execute } as never, 10).increment('k', 1_000, 1, 5_000);
    expect(dialect.sqlToQuery((execute.mock.calls[0] as unknown as [SQL])[0]).params.at(-1)).toBe(5_000);
  });

  it('fails loudly if the function returns nothing', async () => {
    const storage = new PostgresThrottlerStorage({ execute: async () => ({ rows: [] }) } as never, 1);
    await expect(storage.increment('k', 1, 1, 1)).rejects.toThrow(/no row/);
  });
});

describe('trackers', () => {
  it('key the IP throttler on the resolved client IP', () => {
    expect(ipTracker({ clientIp: '10.0.0.1' })).toBe('ip:10.0.0.1');
    expect(ipTracker({})).toBe('ip:unknown');
  });

  it('group IPv6 clients by their /64, so rotating addresses inside one prefix shares the limit', () => {
    const key = 'ip:2001:db8:a:b::/64';
    expect(ipTracker({ clientIp: '2001:db8:a:b::1' })).toBe(key);
    expect(ipTracker({ clientIp: '2001:DB8:A:B:ffff:1:2:3' })).toBe(key);
    expect(ipTracker({ clientIp: '2001:0db8:000a:000b:0:0:0:9' })).toBe(key);
    expect(ipTracker({ clientIp: '2001:db8:a:b:1::%eth0' })).toBe(key);
    expect(ipTracker({ clientIp: '2001:db8:a:c::1' })).toBe('ip:2001:db8:a:c::/64');
    expect(ipTracker({ clientIp: '::1' })).toBe('ip:0:0:0:0::/64');
    expect(ipTracker({ clientIp: '::' })).toBe('ip:0:0:0:0::/64');
    expect(ipTracker({ clientIp: '2001:db8::' })).toBe('ip:2001:db8:0:0::/64');
    expect(ipTracker({ clientIp: '64:ff9b::192.0.2.1' })).toBe('ip:64:ff9b:0:0::/64');
  });

  it('key IPv4-mapped IPv6 addresses as the IPv4 they carry, and leave anything else untouched', () => {
    expect(ipTracker({ clientIp: '::ffff:10.0.0.1' })).toBe('ip:10.0.0.1');
    expect(ipTracker({ clientIp: '::FFFF:10.0.0.1' })).toBe('ip:10.0.0.1');
    expect(ipTracker({ clientIp: 'not-an-ip' })).toBe('ip:not-an-ip');
  });

  it('key the credential throttler on (IP, normalized email) or (IP, user), never on the email alone', () => {
    expect(credentialTracker({ clientIp: '10.0.0.1', body: { email: ' Owner@Example.com ' } })).toBe('ip:10.0.0.1|email:owner@example.com');
    expect(credentialTracker({ clientIp: '10.0.0.1', body: { email: 42 } })).toBe('ip:10.0.0.1|email:');
    expect(credentialTracker({ clientIp: '10.0.0.1' })).toBe('ip:10.0.0.1|email:');
    expect(credentialTracker({ clientIp: '10.0.0.1', actor: { userId: 'u1' }, body: { email: 'x@y.z' } })).toBe('ip:10.0.0.1|user:u1');
  });

  it('back off progressively up to a cap, never a permanent lock', () => {
    expect(RATE_LIMITS.maxBlockMs).toBeGreaterThan(RATE_LIMITS.credential.blockDuration);
    expect(Number.isFinite(RATE_LIMITS.maxBlockMs)).toBe(true);
  });
});
