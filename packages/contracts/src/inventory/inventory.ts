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

const COSTS_NOTE = 'Null without catalog:write or inventory:write in that location (D10)';
const HIDDEN_NOTE = 'null when the actor lacks inventory:view there: show it as "otro punto"';

export const StockItem = z
  .object({
    productId: Uuid,
    name: z.string(),
    unitOfMeasure: z.string(),
    category: z.string().nullable(),
    quantity: z.number().meta({ description: 'SUM(quantity_delta), at most 3 decimals' }),
    lowStockThreshold: z.number().meta({ description: "Effective threshold (getProductThreshold): the product's, else its category's, else the general one" }),
    isLow: z.boolean().meta({ description: 'quantity < lowStockThreshold' }),
    averageCost: AverageCost.nullable().meta({ description: COSTS_NOTE }),
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
    averageCost: AverageCost.nullable().meta({ description: COSTS_NOTE }),
  })
  .meta({ id: 'ProductStockByLocation' });
export type ProductStockByLocation = z.infer<typeof ProductStockByLocation>;

/** `GET /products/:id/stock`: only the locations where the actor has `inventory:view`. */
export const ProductStock = z
  .object({
    productId: Uuid,
    locations: z.array(ProductStockByLocation).meta({ description: 'Visible locations only, by name' }),
  })
  .meta({ id: 'ProductStock' });
export type ProductStock = z.infer<typeof ProductStock>;

export const InventoryMovement = z
  .object({
    id: Uuid,
    documentId: Uuid,
    locationId: Uuid.meta({ description: 'The location whose stock this movement changes' }),
    counterpartLocationId: Uuid.nullable().meta({ description: `The other location of a transfer; null for any other document, or ${HIDDEN_NOTE}` }),
    counterpartLocationName: z.string().nullable().meta({ description: `Same visibility as counterpartLocationId` }),
    productId: Uuid,
    kind: InventoryMovementKind,
    quantityDelta: z.number(),
    unitCost: AverageCost.nullable().meta({ description: COSTS_NOTE }),
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
    locationId: Uuid.nullable().meta({ description: `Origin of a transfer, or the only location of any other document; ${HIDDEN_NOTE}` }),
    locationName: z.string().nullable(),
    targetLocationId: Uuid.nullable().meta({ description: `Destination of a transfer (null for other kinds); ${HIDDEN_NOTE}` }),
    targetLocationName: z.string().nullable(),
    reason: ExitReason.nullable(),
    reversesDocumentId: Uuid.nullable(),
    occurredAt: IsoDateTime,
    notes: z.string().nullable(),
    createdBy: Uuid,
    createdAt: IsoDateTime,
    movements: z.array(InventoryMovement).meta({ description: 'Only the movements in locations where the actor has inventory:view' }),
  })
  .meta({ id: 'InventoryDocument' });
export type InventoryDocument = z.infer<typeof InventoryDocument>;

/** Path parameter of the `/locations/:locationId/...` inventory reads. */
export const LocationIdParams = z.object({ locationId: Uuid }).meta({ id: 'LocationIdParams' });
export type LocationIdParams = z.infer<typeof LocationIdParams>;

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
    from: IsoDateTime.optional().meta({ description: 'Movements recorded at or after this instant' }),
    to: IsoDateTime.optional().meta({ description: 'Movements recorded at or before this instant' }),
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
