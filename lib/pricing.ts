export function calculateTransferPrice(cashPrice: number, surchargePercent: number = 10): number {
  return Math.round((cashPrice * (1 + surchargePercent / 100)) / 5) * 5;
}
