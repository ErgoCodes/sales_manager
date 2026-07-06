export function calculateTransferPrice(cashPrice: number): number {
  return Math.round((cashPrice * 1.1) / 5) * 5;
}
