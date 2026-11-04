import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/database';
import { DATABASE } from '../../../infrastructure/db/database.tokens';
import type { DatabaseHealthPort } from '../domain/database-health.port';

/** Pings Postgres with `select 1` through the shared Drizzle pool. */
export class DrizzleDatabaseHealthAdapter implements DatabaseHealthPort {
  constructor(@Inject(DATABASE) private readonly db: Pick<Database, 'execute'>) {}

  async ping(): Promise<boolean> {
    await this.db.execute(sql`select 1`);
    return true;
  }
}
