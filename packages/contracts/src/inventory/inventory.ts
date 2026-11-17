import { z } from 'zod';

import { AverageCost, IsoDateTime, Money, Paginated, Quantity, SignedQuantity, Uuid } from '../common';

/**
 * Ledger movement kinds. `@monaco/domain` owns the list and the sign of each kind;
 * a test in apps/api (T5a) checks both lists are equal, like the permission CHECK.
 */
export const INVENTORY_MOVEMENT_KINDS = [
  'entry',
  'shrinkage',
  'owner_withdrawal',
  'adjustment',
  'transfer_out',
  'transfer_in',
  'reversal',
] as const;
export const InventoryMovementKind = z.enum(INVENTORY_MOVEMENT_KINDS).meta({ id: 'InventoryMovementKind' });
export type InventoryMovementKind = z.infer<typeof InventoryMovementKind>;

export const INVENTORY_DOCUMENT_KINDS = ['entry', 'exit', 'adjustment', 'transfer', 'reversal'] as const;
export const InventoryDocumentKind = z.enum(INVENTORY_DOCUMENT_KINDS).meta({ id: 'InventoryDocumentKind' });
export type InventoryDocumentKind = z.infer<typeof InventoryDocumentKind>;

export const EXIT_REASONS = ['shrinkage', 'owner_withdrawal'] as const;
export const ExitReason = z.enum(EXIT_REASONS).meta({ id: 'ExitReason' });
export type ExitReason = z.infer<typeof ExitReason>;

export const MAX_DOCUMENT_LINES = 100;
export const MAX_NOTES_LENGTH = 500;

const notes = z.string().trim().max(MAX_NOTES_LENGTH);
const occurredAt = IsoDateTime;

/** 1..100 lines and no repeated product inside the document. */
function lines<T extends z.ZodType<{ productId: string }>>(line: T) {
  return z
    .array(line)
    .min(1)
    .max(MAX_DOCUMENT_LINES)
    .refine((items) => new Set(items.map((l) => l.productId)).size === items.length, 'A product may appear only once per document');
}

// ---------- Reads ----------

export const StockItem = z
  .object({
    productId: Uuid,
    name: z.string(),
    unitOfMeasure: z.string(),
    category: z.string().nullable(),
    quantity: z.number().meta({ description: 'SUM(quantity_delta), at most 3 decimals' }),
    lowStockThreshold: z.number().nullable(),
    isLow: z.boolean(),
    averageCost: AverageCost.nullable().meta({ description: 'Null without catalog:write or inventory:write in scope' }),
    archivedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'StockItem' });
export type StockItem = z.infer<typeof StockItem>;
export const PaginatedStockItems = Paginated(StockItem, 'PaginatedStockItems');

export const ProductStockByLocation = z
  .object({
    locationId: Uuid,
    locationName: z.string(),
    quantity: z.number(),
    averageCost: AverageCost.nullable(),
  })
  .meta({ id: 'ProductStockByLocation' });
export type ProductStockByLocation = z.infer<typeof ProductStockByLocation>;

export const InventoryMovement = z
  .object({
    id: Uuid,
    documentId: Uuid,
    locationId: Uuid.nullable().meta({ description: 'Null when the other transfer location is not visible to the actor' }),
    productId: Uuid,
    kind: InventoryMovementKind,
    quantityDelta: z.number(),
    unitCost: AverageCost.nullable().meta({ description: 'Null without cost visibility' }),
    reversesMovementId: Uuid.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'InventoryMovement' });
export type InventoryMovement = z.infer<typeof InventoryMovement>;
export const PaginatedInventoryMovements = Paginated(InventoryMovement, 'PaginatedInventoryMovements');

export const InventoryDocument = z
  .object({
    id: Uuid,
    kind: InventoryDocumentKind,
    locationId: Uuid,
    targetLocationId: Uuid.nullable(),
    reason: ExitReason.nullable(),
    reversesDocumentId: Uuid.nullable(),
    occurredAt: IsoDateTime,
    notes: z.string().nullable(),
    createdBy: Uuid,
    createdAt: IsoDateTime,
    movements: z.array(InventoryMovement),
  })
  .meta({ id: 'InventoryDocument' });
export type InventoryDocument = z.infer<typeof InventoryDocument>;

export const StockQuery = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    lowStockOnly: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z
      .union([z.string().regex(/^\d+$/).transform(Number), z.number()])
      .pipe(z.int().min(1).max(100))
      .default(50),
  })
  .meta({ id: 'StockQuery' });
export type StockQuery = z.infer<typeof StockQuery>;

export const MovementsQuery = z
  .object({
    productId: Uuid.optional(),
    kind: InventoryMovementKind.optional(),
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z
      .union([z.string().regex(/^\d+$/).transform(Number), z.number()])
      .pipe(z.int().min(1).max(100))
      .default(50),
  })
  .meta({ id: 'MovementsQuery' });
export type MovementsQuery = z.infer<typeof MovementsQuery>;

// ---------- Commands (the client generates `id`: idempotency key) ----------

export const CreateEntryRequest = z
  .strictObject({
    id: Uuid,
    locationId: Uuid,
    occurredAt: occurredAt.optional(),
    notes: notes.optional(),
    lines: lines(z.strictObject({ productId: Uuid, quantity: Quantity, unitCost: Money })),
  })
  .meta({ id: 'CreateEntryRequest' });
export type CreateEntryRequest = z.infer<typeof CreateEntryRequest>;

export const CreateExitRequest = z
  .strictObject({
    id: Uuid,
    locationId: Uuid,
    reason: ExitReason,
    occurredAt: occurredAt.optional(),
    notes: notes.optional(),
    lines: lines(z.strictObject({ productId: Uuid, quantity: Quantity })),
  })
  .meta({ id: 'CreateExitRequest' });
export type CreateExitRequest = z.infer<typeof CreateExitRequest>;

export const CreateAdjustmentRequest = z
  .strictObject({
    id: Uuid,
    locationId: Uuid,
    occurredAt: occurredAt.optional(),
    notes: notes.optional(),
    lines: lines(z.strictObject({ productId: Uuid, quantityDelta: SignedQuantity })),
  })
  .meta({ id: 'CreateAdjustmentRequest' });
export type CreateAdjustmentRequest = z.infer<typeof CreateAdjustmentRequest>;

export const CreateTransferRequest = z
  .strictObject({
    id: Uuid,
    fromLocationId: Uuid,
    toLocationId: Uuid,
    occurredAt: occurredAt.optional(),
    notes: notes.optional(),
    lines: lines(z.strictObject({ productId: Uuid, quantity: Quantity })),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, { message: 'Origin and destination must differ', path: ['toLocationId'] })
  .meta({ id: 'CreateTransferRequest' });
export type CreateTransferRequest = z.infer<typeof CreateTransferRequest>;

export const CreateReversalRequest = z
  .strictObject({ id: Uuid, notes: notes.optional() })
  .meta({ id: 'CreateReversalRequest' });
export type CreateReversalRequest = z.infer<typeof CreateReversalRequest>;
