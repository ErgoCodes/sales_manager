/** Stable `ErrorResponse.code` values introduced by SP3 (catalog and inventory). */
export const INVENTORY_ERROR_CODES = [
  'INSUFFICIENT_STOCK',
  'IDEMPOTENCY_CONFLICT',
  'ALREADY_REVERSED',
  'ARCHIVED',
  'CURRENCY_MISMATCH',
  'CONFLICT',
] as const;
export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

/**
 * Stable `ErrorResponse.code` values introduced by SP4. `DEMO_READ_ONLY` (403): the tenant is
 * read-only (public demo, D10) and the request is a mutation outside the allow list.
 */
export const DEMO_ERROR_CODES = ['DEMO_READ_ONLY'] as const;
export type DemoErrorCode = (typeof DEMO_ERROR_CODES)[number];
