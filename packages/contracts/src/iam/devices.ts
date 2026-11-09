import { z } from 'zod';

import { IsoDateTime, Paginated, PaginationQuery, Uuid } from '../common';
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

/** GET /devices: the caller's own devices, or another user's (`devices:manage`). */
export const ListDevicesQuery = PaginationQuery.extend({
  userId: Uuid.optional().meta({ description: 'Whose devices; defaults to the caller' }),
}).meta({ id: 'ListDevicesQuery' });
export type ListDevicesQuery = z.infer<typeof ListDevicesQuery>;
