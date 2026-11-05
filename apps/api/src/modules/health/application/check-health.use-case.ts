import type { DatabaseHealthPort } from '../domain/database-health.port';
import type { HealthStatus } from '../domain/health-status';

/**
 * Use case: report whether the API and its dependencies are healthy.
 *
 * Application services are plain classes that receive ports through their
 * constructor. They are wired in the module with `useFactory`, so this layer
 * never imports `@nestjs/*` and can be unit-tested with hand-written fakes.
 */
export class CheckHealth {
  constructor(
    private readonly database: DatabaseHealthPort,
    private readonly version: string,
    private readonly timeoutMs = 2_000,
  ) {}

  async execute(): Promise<HealthStatus> {
    const db = (await this.pingDatabase()) ? 'up' : 'down';
    return { status: db === 'up' ? 'ok' : 'error', version: this.version, db };
  }

  private async pingDatabase(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), this.timeoutMs);
    });
    try {
      return await Promise.race([this.database.ping(), timeout]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
