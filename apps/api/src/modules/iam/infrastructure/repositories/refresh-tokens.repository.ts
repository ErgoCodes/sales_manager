import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { SessionRevocationReason } from '../../domain/auth-policy';
import type { NewRefreshToken, RefreshTokenRecord, RefreshTokenRepository } from '../../domain/auth-ports';
import { rows, toBytea, toDate } from '../sql-helpers';

export class RefreshTokensRepository implements RefreshTokenRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async startFamily(token: NewRefreshToken): Promise<string> {
    const familyId = uuidv7(token.now.getTime());
    await this.append(familyId, token);
    return familyId;
  }

  async append(familyId: string, token: NewRefreshToken): Promise<void> {
    await this.tx.execute(
      sql`insert into refresh_tokens (id, tenant_id, device_id, family_id, token_hash, created_at, expires_at, absolute_expires_at)
          values (${uuidv7(token.now.getTime())}, ${this.tenantId}, ${token.deviceId}, ${familyId}, ${toBytea(token.tokenHash)},
                  ${token.now}, ${token.expiresAt}, ${token.absoluteExpiresAt})`,
    );
  }

  /** Locks only the token row (`FOR UPDATE OF r`); device and user are read for their state. */
  async findForUpdate(tokenHash: Uint8Array): Promise<RefreshTokenRecord | null> {
    const [row] = await rows<RefreshTokenRecord>(
      this.tx,
      sql`select r.id, r.family_id as "familyId", r.device_id as "deviceId", d.user_id as "userId",
                 r.expires_at as "expiresAt", r.absolute_expires_at as "absoluteExpiresAt",
                 r.rotated_at as "rotatedAt", r.revoked_at as "revokedAt",
                 d.revoked_at as "deviceRevokedAt", u.status as "userStatus"
          from refresh_tokens r
          join devices d on d.id = r.device_id and d.tenant_id = r.tenant_id
          join users u on u.id = d.user_id and u.tenant_id = d.tenant_id
          where r.token_hash = ${toBytea(tokenHash)}
          for update of r`,
    );
    if (!row) return null;
    return {
      ...row,
      expiresAt: toDate(row.expiresAt),
      absoluteExpiresAt: toDate(row.absoluteExpiresAt),
      rotatedAt: toDate(row.rotatedAt),
      revokedAt: toDate(row.revokedAt),
      deviceRevokedAt: toDate(row.deviceRevokedAt),
    };
  }

  async markRotated(tokenId: string, now: Date): Promise<void> {
    await this.tx.execute(sql`update refresh_tokens set rotated_at = ${now} where id = ${tokenId}`);
  }

  async revokeFamily(familyId: string, reason: SessionRevocationReason, now: Date): Promise<void> {
    await this.tx.execute(
      sql`update refresh_tokens set revoked_at = ${now}, revoked_reason = ${reason}
          where family_id = ${familyId} and revoked_at is null`,
    );
  }

  async revokeByDevices(deviceIds: readonly string[], reason: SessionRevocationReason, now: Date): Promise<void> {
    if (deviceIds.length === 0) return;
    await this.tx.execute(
      sql`update refresh_tokens set revoked_at = ${now}, revoked_reason = ${reason}
          where device_id = any(${sql.param([...deviceIds])}::uuid[]) and revoked_at is null`,
    );
  }
}
