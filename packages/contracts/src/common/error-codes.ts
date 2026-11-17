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
