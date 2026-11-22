import { InvalidQuantityError, toMinorUnits, toThousandths } from './inventory';

export const PAYMENT_METHODS = ['cash', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Mobile payment methods (`ventas.metodo_pago`) and their server equivalent, 1:1. */
export const LEGACY_PAYMENT_METHOD = {
  efectivo: 'cash',
  transferencia: 'transfer',
} as const satisfies Record<string, PaymentMethod>;

/** Scale of an average cost: minor units with 6 decimals (numeric(20,6)). */
const COST_DECIMALS = 6;
const COST_SCALE = 1_000_000;
const QUANTITY_SCALE = 1000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Non-negative division of BigInts rounded half up. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Division of BigInts rounded half away from zero (denominator > 0). */
function divideHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const magnitude = divideHalfUp(numerator < 0n ? -numerator : numerator, denominator);
  return numerator < 0n ? -magnitude : magnitude;
}

function toSafeNumber(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new InvalidQuantityError('Amount out of range');
  return Number(value) + 0;
}

function assertMinorUnits(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidQuantityError(`${name} must be a non-negative integer in minor units`);
  }
}

/** A cost in minor units (up to 6 decimals) as an integer of millionths of a minor unit. */
function costToMicro(unitCost: number): bigint {
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new InvalidQuantityError('Unit cost must be a non-negative finite number');
  }
  return BigInt(toMinorUnits(unitCost, COST_DECIMALS));
}

/** |quantity| × unit cost, in millionths of a minor unit, before rounding (units of 1e-9). */
function rawCostNano(quantity: number, unitCost: number): bigint {
  const thousandths = BigInt(toThousandths(quantity));
  return (thousandths < 0n ? -thousandths : thousandths) * costToMicro(unitCost);
}

export interface SaleLineInput {
  /** Quantity sold, positive, at most 3 decimals (kg, litres). */
  quantity: number;
  /** Applied unit price (discount included), integer minor units. */
  unitPrice: number;
  /** `effectiveUnitCost` of the pair: minor units with up to 6 decimals. */
  unitCost: number;
  isCostSale: boolean;
}

export interface SaleLineAmounts {
  /** `round(quantity × unitPrice)`, integer minor units. */
  lineTotal: number;
  /** `lineTotal − quantity × unitCost` (0 on a cost sale): minor units, 6 decimals. */
  profit: number;
}

/**
 * Amounts of a sale line, frozen when the sale is written. Integer arithmetic on
 * thousandths of quantity: the line total rounds half up to a minor unit, the cost
 * keeps its fraction rounded half up to 6 decimals. Throws when a result is not exact
 * in a double (line totals up to 2^53 minor units, profits up to ~9·10^9 minor units).
 */
export function saleLineAmounts(input: SaleLineInput): SaleLineAmounts {
  const thousandths = toThousandths(input.quantity);
  if (thousandths <= 0) throw new InvalidQuantityError('Quantity must be greater than zero');
  assertMinorUnits(input.unitPrice, 'Unit price');
  const lineTotal = toSafeNumber(divideHalfUp(BigInt(thousandths) * BigInt(input.unitPrice), QUANTITY_SCALE));
  const costMicro = divideHalfUp(rawCostNano(input.quantity, input.unitCost), QUANTITY_SCALE);
  if (input.isCostSale) return { lineTotal, profit: 0 };
  const profitMicro = BigInt(lineTotal) * BigInt(COST_SCALE) - costMicro;
  return { lineTotal, profit: toSafeNumber(profitMicro) / COST_SCALE + 0 };
}

/** `profit / sales` with 4 decimals, half away from zero; `null` when there are no sales. */
export function marginRatio(profit: number, totalSales: number): number | null {
  assertMinorUnits(totalSales, 'Total sales');
  if (!Number.isFinite(profit)) throw new InvalidQuantityError('Profit must be a finite number');
  if (totalSales === 0) return null;
  const profitMicro = BigInt(toMinorUnits(profit, COST_DECIMALS));
  // ratio × 10^4 = profitMicro / (sales × 10^6) × 10^4
  const scaled = divideHalfAwayFromZero(profitMicro, BigInt(totalSales) * 100n);
  return Number(scaled) / 10_000 + 0;
}

/** `round(totalSales / tickets)` in minor units, half up; `null` when there are no tickets. */
export function averageTicket(totalSales: number, tickets: number): number | null {
  assertMinorUnits(totalSales, 'Total sales');
  if (!Number.isSafeInteger(tickets) || tickets < 0) throw new InvalidQuantityError('Tickets must be a non-negative integer');
  if (tickets === 0) return null;
  return Number(divideHalfUp(BigInt(totalSales), BigInt(tickets))) + 0;
}

export interface ValuedMovement {
  /** Signed quantity delta of the movement; only its magnitude counts. */
  quantityDelta: number;
  /** Unit cost of the movement: minor units with up to 6 decimals. */
  unitCost: number;
}

/**
 * `Σ |quantityDelta| × unitCost` in minor units, rounded half up to 6 decimals once over
 * the whole sum, in integer arithmetic. The value of valued entries and of the
 * inventory (stock × average cost), and the rule behind `lossValue`.
 */
export function costValue(movements: readonly ValuedMovement[]): number {
  let nano = 0n;
  for (const movement of movements) nano += rawCostNano(movement.quantityDelta, movement.unitCost);
  return toSafeNumber(divideHalfUp(nano, QUANTITY_SCALE)) / COST_SCALE + 0;
}

/**
 * Value of loss outflows (shrinkage, owner withdrawals): `Σ |quantityDelta| × unitCost`,
 * the same rule as mobile's `sumLossOutflowsValue` (`costValue`).
 */
export function lossValue(movements: readonly ValuedMovement[]): number {
  return costValue(movements);
}
