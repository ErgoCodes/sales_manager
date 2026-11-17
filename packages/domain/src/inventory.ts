import { blendAverageCost } from './average-cost';
import { calculateTransferPrice } from './pricing';

export const INVENTORY_MOVEMENT_KINDS = [
  'entry',
  'shrinkage',
  'owner_withdrawal',
  'adjustment',
  'transfer_out',
  'transfer_in',
  'reversal',
] as const;
export type InventoryMovementKind = (typeof INVENTORY_MOVEMENT_KINDS)[number];

/** Mobile movement types that have an equivalent kind in the ledger. */
export const LEGACY_MOVEMENT_KIND = {
  entrada: 'entry',
  merma: 'shrinkage',
  retiro_owner: 'owner_withdrawal',
  ajuste: 'adjustment',
} as const satisfies Record<string, InventoryMovementKind>;

export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

export class InsufficientStockError extends Error {
  /** Stock (major units) available right before the movement that failed. */
  readonly available: number;
  /** Missing quantity (major units) to keep the stock at zero. */
  readonly shortBy: number;
  constructor(available: number, shortBy: number) {
    super(`Insufficient stock: ${available} available, short by ${shortBy}`);
    this.name = 'InsufficientStockError';
    this.available = available;
    this.shortBy = shortBy;
  }
}

const QUANTITY_SCALE = 1000;

/** Converts a quantity with at most 3 decimals to integer thousandths. */
export function toThousandths(quantity: number): number {
  if (!Number.isFinite(quantity)) throw new InvalidQuantityError('Quantity must be a finite number');
  const scaled = quantity * QUANTITY_SCALE;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) throw new InvalidQuantityError('Quantity allows at most 3 decimals');
  return rounded + 0;
}

export function fromThousandths(thousandths: number): number {
  return thousandths / QUANTITY_SCALE + 0;
}

export function addQuantities(a: number, b: number): number {
  return fromThousandths(toThousandths(a) + toThousandths(b));
}

const POSITIVE_KINDS: ReadonlySet<InventoryMovementKind> = new Set(['entry', 'transfer_in']);
const NEGATIVE_KINDS: ReadonlySet<InventoryMovementKind> = new Set(['shrinkage', 'owner_withdrawal', 'transfer_out']);

/** Signed stock delta of a movement. `adjustment` and `reversal` carry their own non-zero sign. */
export function movementDelta(kind: InventoryMovementKind, quantity: number): number {
  const thousandths = toThousandths(quantity);
  if (thousandths === 0) throw new InvalidQuantityError('Quantity must not be zero');
  if (POSITIVE_KINDS.has(kind) || NEGATIVE_KINDS.has(kind)) {
    if (thousandths < 0) throw new InvalidQuantityError(`Quantity for ${kind} must be positive`);
    return fromThousandths(NEGATIVE_KINDS.has(kind) ? -thousandths : thousandths);
  }
  return fromThousandths(thousandths);
}

/**
 * Applies deltas in order to the current stock of one (location, product) pair and
 * returns the resulting stock. No prefix may go below zero.
 */
export function assertStockNotNegative(current: number, deltas: readonly number[]): number {
  let running = toThousandths(current);
  if (running < 0) throw new InsufficientStockError(0, fromThousandths(-running));
  for (const delta of deltas) {
    const next = running + toThousandths(delta);
    if (next < 0) throw new InsufficientStockError(fromThousandths(running), fromThousandths(-next));
    running = next;
  }
  return fromThousandths(running);
}

export function averageCostAfterEntry(
  currentStock: number,
  currentAverageCost: number,
  quantity: number,
  unitCost: number,
): number {
  return blendAverageCost(currentStock, currentAverageCost, quantity, unitCost);
}

/** Incoming transfer: the destination blends in the source's average cost. */
export function averageCostAfterTransferIn(
  destinationStock: number,
  destinationAverageCost: number,
  quantity: number,
  sourceAverageCost: number,
): number {
  return blendAverageCost(destinationStock, destinationAverageCost, quantity, sourceAverageCost);
}

export interface LedgerLine {
  documentId: string;
  kind: InventoryMovementKind;
  quantityDelta: number;
  unitCost: number;
  /** Set on lines of a reversal document: the document it reverses. */
  reversesDocumentId: string | null;
}

/**
 * Deterministic replay of one (location, product) ledger, in insertion order.
 * Blends on `entry` and `transfer_in` with the stock at that point; reverted
 * documents and their reversals are skipped. Returns 0 when nothing remains.
 */
export function replayAverageCost(ledger: readonly LedgerLine[]): number {
  const reverted = new Set<string>();
  for (const line of ledger) if (line.reversesDocumentId !== null) reverted.add(line.reversesDocumentId);
  let stock = 0;
  let average = 0;
  for (const line of ledger) {
    if (line.reversesDocumentId !== null || reverted.has(line.documentId)) continue;
    if (line.kind === 'entry' || line.kind === 'transfer_in') {
      average = blendAverageCost(fromThousandths(stock), average, line.quantityDelta, line.unitCost);
    }
    stock += toThousandths(line.quantityDelta);
  }
  return average;
}

function assertExponent(exponent: number): void {
  if (!Number.isInteger(exponent) || exponent < 0) throw new InvalidQuantityError('Invalid currency exponent');
}

export function toMinorUnits(amount: number, exponent = 2): number {
  assertExponent(exponent);
  if (!Number.isFinite(amount)) throw new InvalidQuantityError('Amount must be a finite number');
  return Math.round(Number((amount * 10 ** exponent).toPrecision(12))) + 0;
}

export function fromMinorUnits(minor: number, exponent = 2): number {
  assertExponent(exponent);
  return minor / 10 ** exponent + 0;
}

/** Same rule as `calculateTransferPrice`, in minor units. */
export function calculateTransferPriceMinor(cashPriceMinor: number, surchargePercent = 10, exponent = 2): number {
  return toMinorUnits(calculateTransferPrice(fromMinorUnits(cashPriceMinor, exponent), surchargePercent), exponent);
}
