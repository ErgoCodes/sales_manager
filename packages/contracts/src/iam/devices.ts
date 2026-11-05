import { z } from 'zod';

import { IsoDateTime, Paginated, Uuid } from '../common';
import { DevicePlatform } from './auth';

export const Device = z
  .object({
    id: Uuid,
    userId: Uuid,
    label: z.string(),
    platform: DevicePlatform,
    createdAt: IsoDateTime,
    lastSeenAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime.nullable(),
    current: z.boolean().meta({ description: 'True for the device that made the request' }),
  })
  .meta({ id: 'Device' });
export type Device = z.infer<typeof Device>;

export const PaginatedDevices = Paginated(Device, 'PaginatedDevices');
