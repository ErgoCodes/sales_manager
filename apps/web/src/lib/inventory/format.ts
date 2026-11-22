import type { AverageCost, ExitReason, InventoryDocumentKind, InventoryMovementKind } from '@monaco/contracts';
import { formatCurrency, fromMinorUnits } from '@monaco/domain';

const QUANTITY = new Intl.NumberFormat('es-CU', { maximumFractionDigits: 3 });

/** Quantity with up to 3 decimals (kg, litres). */
export function formatQuantity(quantity: number): string {
  return QUANTITY.format(quantity);
}

/** A ledger delta, with its sign: `+2`, `-0.5`. */
export function formatSignedQuantity(delta: number): string {
  return delta > 0 ? `+${formatQuantity(delta)}` : formatQuantity(delta);
}

/** Average or unit cost (minor units with sub-cent fraction). Null (hidden by D10) is a dash, never a zero. */
export function formatAverageCost(cost: AverageCost | null): string {
  return cost ? `${formatCurrency(fromMinorUnits(cost.amount))} ${cost.currency}` : '—';
}

export const MOVEMENT_KIND_LABELS: Record<InventoryMovementKind, string> = {
  entry: 'Entrada',
  shrinkage: 'Merma',
  owner_withdrawal: 'Retiro del propietario',
  adjustment: 'Ajuste',
  transfer_out: 'Transferencia enviada',
  transfer_in: 'Transferencia recibida',
  reversal: 'Reversión',
  sale: 'Venta',
};

export const DOCUMENT_KIND_LABELS: Record<InventoryDocumentKind, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  adjustment: 'Ajuste',
  transfer: 'Transferencia',
  reversal: 'Reversión',
  sale: 'Venta',
};

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  shrinkage: 'Merma',
  owner_withdrawal: 'Retiro del propietario',
};

/** Label shown for a location the actor cannot see (spec: "otro punto"). */
export const OTHER_LOCATION = 'Otro punto';

/** The other location of a transfer movement: its name, or "Otro punto" when the API masked it. */
export function counterpartName(movement: { kind: InventoryMovementKind; counterpartLocationName: string | null }): string {
  if (movement.counterpartLocationName) return movement.counterpartLocationName;
  return movement.kind === 'transfer_in' || movement.kind === 'transfer_out' ? OTHER_LOCATION : '—';
}
