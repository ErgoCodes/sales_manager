/** Salidas de almacén que no son ventas (T-13). */
export const OUTFLOW_TYPES = [
  { label: 'Merma', value: 'merma' },
  { label: 'Retiro del dueño', value: 'retiro_owner' },
  { label: 'Ajuste de inventario', value: 'ajuste' },
] as const;

export type OutflowType = (typeof OUTFLOW_TYPES)[number]['value'];

/** Gastos periódicos que reducen la utilidad real (T-14, T-15). */
export const EXPENSE_TYPES = [
  { label: 'Salario', value: 'salario' },
  { label: 'Multa', value: 'multa' },
  { label: 'ONAT', value: 'onat' },
  { label: 'Rebaja de liquidación', value: 'rebaja_liquidacion' },
] as const;

export type ExpenseType = (typeof EXPENSE_TYPES)[number]['value'];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  [...OUTFLOW_TYPES, ...EXPENSE_TYPES].map((t) => [t.value, t.label]),
);

/** Devuelve la etiqueta legible de un tipo de salida o gasto. */
export function getTypeLabel(value: string): string {
  return TYPE_LABELS[value] ?? value;
}
