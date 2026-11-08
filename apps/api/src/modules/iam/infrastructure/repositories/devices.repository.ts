import type { DevicePlatform } from '@monaco/contracts';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import type { DeviceRepository } from '../../domain/auth-ports';
import { rows } from '../sql-helpers';

export class DevicesRepository implements DeviceRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async findActive(deviceId: string, userId: string): Promise<{ id: string } | null> {
    const [row] = await rows<{ id: string }>(
      this.tx,
      sql`select id from devices where id = ${deviceId} and user_id = ${userId} and revoked_at is null`,
    );
    return row ?? null;
  }

  async create(input: { userId: string; label: string; platform: DevicePlatform; now: Date }): Promise<string> {
    const id = uuidv7(input.now.getTime());
    await this.tx.execute(
      sql`insert into devices (id, tenant_id, user_id, label, platform, created_at, last_seen_at)
          values (${id}, ${this.tenantId}, ${input.userId}, ${input.label},
                  ${input.platform}, ${input.now}, ${input.now})`,
    );
    return id;
  }

  async touch(deviceId: string, now: Date): Promise<void> {
    await this.tx.execute(sql`update devices set last_seen_at = ${now} where id = ${deviceId}`);
  }

  async revokeAllExcept(userId: string, keepDeviceId: string, now: Date): Promise<string[]> {
    const revoked = await rows<{ id: string }>(
      this.tx,
      sql`update devices set revoked_at = ${now}
          where user_id = ${userId} and id <> ${keepDeviceId} and revoked_at is null
          returning id`,
    );
    return revoked.map((row) => row.id);
  }
}
