import type { DevicePlatform, Paginated } from '@monaco/contracts';

import type { PageRequest } from '../../iam/domain/admin-ports';

export interface DeviceRecord {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly platform: DevicePlatform;
  readonly createdAt: Date;
  readonly lastSeenAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface DeviceAdminRepository {
  /** Newest first. */
  listByUser(userId: string, page: PageRequest): Promise<Paginated<DeviceRecord>>;
  findById(id: string): Promise<DeviceRecord | null>;
  /**
   * Marks the device revoked (once; the first date is kept). The UPDATE locks
   * the device row, so callers revoke its tokens afterwards: device, then tokens.
   */
  revoke(id: string, now: Date): Promise<DeviceRecord | null>;
}
