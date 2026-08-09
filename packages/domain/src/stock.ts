export const POSITIVE_MOVEMENT_TYPES = ['entrada', 'ajuste'];
export function stockDelta(type: string, quantity: number): number { return POSITIVE_MOVEMENT_TYPES.includes(type) ? quantity : -quantity; }
export function deriveStock(movements: ReadonlyArray<{ type: string; quantity: number }>, salesQuantity: number): number { return movements.reduce((total, movement) => total + stockDelta(movement.type, movement.quantity), 0) - salesQuantity; }
