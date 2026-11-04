export type DependencyStatus = 'up' | 'down';

/** Result of a health check, independent of how it is transported. */
export interface HealthStatus {
  status: 'ok' | 'error';
  version: string;
  db: DependencyStatus;
}
