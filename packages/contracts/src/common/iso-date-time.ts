import { z } from 'zod';

/** ISO 8601 UTC instant, e.g. `2026-11-04T12:00:00Z` (always with `Z`, no offsets). */
export const IsoDateTime = z.iso
  .datetime()
  .meta({ id: 'IsoDateTime', description: 'ISO 8601 UTC date-time' });
export type IsoDateTime = z.infer<typeof IsoDateTime>;
