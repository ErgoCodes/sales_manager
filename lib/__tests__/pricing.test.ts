import { calculateTransferPrice } from '../pricing';

describe('calculateTransferPrice', () => {
  it('calculates the transfer price with 10% markup and rounds to nearest 5', () => {
    // Tests from ROADMAP T-04
    expect(calculateTransferPrice(47)).toBe(50);
    expect(calculateTransferPrice(20)).toBe(20);
    expect(calculateTransferPrice(100)).toBe(110);
    expect(calculateTransferPrice(0)).toBe(0);
  });
});
