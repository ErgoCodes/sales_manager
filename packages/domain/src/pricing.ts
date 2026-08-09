export interface UnitCostProduct { averageCost?: number | null; costPrice?: number | null; }
export function calculateTransferPrice(cashPrice: number, surchargePercent = 10): number { return Math.round((cashPrice * (1 + surchargePercent / 100)) / 5) * 5; }
export function effectiveUnitCost(product: UnitCostProduct): number { return product.averageCost && product.averageCost > 0 ? product.averageCost : (product.costPrice ?? 0); }
