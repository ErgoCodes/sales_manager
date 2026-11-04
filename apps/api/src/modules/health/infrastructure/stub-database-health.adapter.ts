import type { DatabaseHealthPort } from '../domain/database-health.port';

/**
 * Placeholder adapter until Postgres + Drizzle land (SP1·T4). It reports the
 * database as down so `/health` never claims a connection that does not exist.
 */
export class StubDatabaseHealthAdapter implements DatabaseHealthPort {
  async ping(): Promise<boolean> {
    return false;
  }
}
