import { calculateTransferPrice, effectiveUnitCost } from '../pricing';

describe('calculateTransferPrice', () => {
  it('calculates the transfer price with 10% markup and rounds to nearest 5', () => {
    // Tests from ROADMAP T-04
    expect(calculateTransferPrice(47)).toBe(50);
    expect(calculateTransferPrice(20)).toBe(20);
    expect(calculateTransferPrice(100)).toBe(110);
    expect(calculateTransferPrice(0)).toBe(0);
  });
});

describe('effectiveUnitCost', () => {
  it('returns averageCost when averageCost is > 0', () => {
    expect(effectiveUnitCost({ averageCost: 45, costPrice: 40 })).toBe(45);
  });

  it('falls back to costPrice when averageCost is 0', () => {
    expect(effectiveUnitCost({ averageCost: 0, costPrice: 45 })).toBe(45);
  });

  it('falls back to costPrice when averageCost is null or undefined', () => {
    expect(effectiveUnitCost({ averageCost: null, costPrice: 45 })).toBe(45);
    expect(effectiveUnitCost({ costPrice: 45 })).toBe(45);
  });

  it('returns 0 when both averageCost and costPrice are missing or 0', () => {
    expect(effectiveUnitCost({ averageCost: 0, costPrice: 0 })).toBe(0);
    expect(effectiveUnitCost({})).toBe(0);
  });
});
