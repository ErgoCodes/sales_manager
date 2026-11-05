import type { PinoLogger } from 'nestjs-pino';

import type { SecurityLog } from '../domain/auth-ports';

/**
 * Security events without a tenant go to the structured log (audit_events
 * always belongs to a real tenant). The email itself is not logged.
 */
export class PinoSecurityLog implements SecurityLog {
  constructor(private readonly logger: Pick<PinoLogger, 'warn'>) {}

  loginWithUnknownEmail(context: { ip: string | null }): void {
    this.logger.warn({ event: 'login_unknown_email', ip: context.ip }, 'Login attempt with an unknown email');
  }
}
