import type { ThrottlerStorage } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';

import type { Database } from '../db/database';

type HitRow = {
  total_hits: number;
  time_to_expire_ms: string | number;
  is_blocked: boolean;
  time_to_block_expire_ms: string | number;
};

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const toSeconds = (ms: string | number) => Math.ceil(Number(ms) / 1000);

/**
 * @nestjs/throttler store shared by every API instance, in Postgres (ADR 0004).
 * monaco_app cannot touch the `rate_limits` table; it can only call
 * `rate_limit_hit()` (SECURITY DEFINER), which counts the hit atomically under
 * a row lock and applies progressive backoff: each consecutive block of a key
 * lasts twice the previous one, up to `maxBlockMs`.
 */
export class PostgresThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly db: Pick<Database, 'execute'>,
    private readonly maxBlockMs: number,
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number): Promise<ThrottlerStorageRecord> {
    const block = Math.max(0, Math.round(blockDuration));
    const { rows } = await this.db.execute<HitRow>(
      sql`select * from rate_limit_hit(${key}, ${Math.round(ttl)}::int, ${limit}::int, ${block}::int, ${Math.max(block, this.maxBlockMs)}::int)`,
    );
    const row = rows[0];
    if (!row) throw new Error('rate_limit_hit returned no row');
    return {
      totalHits: row.total_hits,
      timeToExpire: toSeconds(row.time_to_expire_ms),
      isBlocked: row.is_blocked,
      timeToBlockExpire: toSeconds(row.time_to_block_expire_ms),
    };
  }
}
