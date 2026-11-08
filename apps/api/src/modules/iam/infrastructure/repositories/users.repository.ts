import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import type { UserRecord, UserRepository } from '../../domain/auth-ports';
import { rows, toDate } from '../sql-helpers';

export class UsersRepository implements UserRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async findById(userId: string): Promise<UserRecord | null> {
    const [row] = await rows<UserRecord>(
      this.tx,
      sql`select id, email, display_name as "displayName", status, must_change_password as "mustChangePassword",
                 password_hash as "passwordHash", password_expires_at as "passwordExpiresAt"
          from users where id = ${userId}`,
    );
    return row ? { ...row, passwordExpiresAt: toDate(row.passwordExpiresAt) } : null;
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.tx.execute(
      sql`update users set password_hash = ${passwordHash}, must_change_password = false, password_expires_at = null
          where id = ${userId}`,
    );
  }
}
