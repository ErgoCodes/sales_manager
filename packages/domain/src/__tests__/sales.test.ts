import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  InvalidQuantityError,
  LEGACY_PAYMENT_METHOD,
  PAYMENT_METHODS,
  averageTicket,
  isLowStock,
  costValue,
  lossValue,
  marginRatio,
  saleLineAmounts,
  type PaymentMethod,
} from '../index';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('PAYMENT_METHODS', () => {
  it('lists the server payment methods', () => {
    expect(PAYMENT_METHODS).toEqual(['cash', 'transfer']);
  });

  it('maps the mobile payment methods 1:1', () => {
    expect(LEGACY_PAYMENT_METHOD).toEqual({ efectivo: 'cash', transferencia: 'transfer' });
    const mapped: PaymentMethod[] = Object.values(LEGACY_PAYMENT_METHOD);
    expect([...mapped].sort()).toEqual([...PAYMENT_METHODS].sort());
  });
});

describe('saleLineAmounts', () => {
  it('computes line total and profit in minor units', () => {
    expect(saleLineAmounts({ quantity: 3, unitPrice: 2500, unitCost: 1800, isCostSale: false })).toEqual({
      lineTotal: 7500,
      profit: 2100,
    });
  });

  it('rounds the line total half up on thousandths of quantity', () => {
    // 0.125 kg × 1 minor unit = 0.125 → 0; 0.5 → 1; 1.005 × 100 = 100.5 → 101
    expect(saleLineAmounts({ quantity: 0.125, unitPrice: 1, unitCost: 0, isCostSale: false }).lineTotal).toBe(0);
    expect(saleLineAmounts({ quantity: 0.5, unitPrice: 1, unitCost: 0, isCostSale: false }).lineTotal).toBe(1);
    expect(saleLineAmounts({ quantity: 1.005, unitPrice: 100, unitCost: 0, isCostSale: false }).lineTotal).toBe(101);
    // float multiplication would give 0.29 × 100 = 28.999999999999996
    expect(saleLineAmounts({ quantity: 0.29, unitPrice: 100, unitCost: 0, isCostSale: false }).lineTotal).toBe(29);
  });

  it('keeps the fraction of the cost in the profit, rounded to 6 decimals', () => {
    // 1.5 × 1234.567891 = 1851.8518365 → cost 1851.851837; profit = 3000 − cost
    const { lineTotal, profit } = saleLineAmounts({ quantity: 1.5, unitPrice: 2000, unitCost: 1234.567891, isCostSale: false });
    expect(lineTotal).toBe(3000);
    expect(profit).toBe(1148.148163);
    // 0.333 × 0.000005 = 0.000001665 → 0.000002
    expect(saleLineAmounts({ quantity: 0.333, unitPrice: 0, unitCost: 0.000005, isCostSale: false }).profit).toBe(-0.000002);
  });

  it('allows a negative profit when selling below cost', () => {
    expect(saleLineAmounts({ quantity: 2, unitPrice: 900, unitCost: 1000, isCostSale: false }).profit).toBe(-200);
  });

  it('gives zero profit on a cost sale but keeps the line total', () => {
    expect(saleLineAmounts({ quantity: 2, unitPrice: 1000, unitCost: 1234.5, isCostSale: true })).toEqual({
      lineTotal: 2000,
      profit: 0,
    });
  });

  it('applies the discount through the applied unit price', () => {
    // 10% off a 2500 price: the applied price is 2250
    const full = saleLineAmounts({ quantity: 2, unitPrice: 2500, unitCost: 1000, isCostSale: false });
    const discounted = saleLineAmounts({ quantity: 2, unitPrice: 2250, unitCost: 1000, isCostSale: false });
    expect(discounted).toEqual({ lineTotal: 4500, profit: 2500 });
    expect(full.lineTotal - discounted.lineTotal).toBe(500);
  });

  it('never returns negative zero', () => {
    const { lineTotal, profit } = saleLineAmounts({ quantity: 1, unitPrice: 0, unitCost: 0, isCostSale: false });
    expect(Object.is(lineTotal, 0)).toBe(true);
    expect(Object.is(profit, 0)).toBe(true);
  });

  it('rejects invalid inputs', () => {
    const base = { quantity: 1, unitPrice: 100, unitCost: 50, isCostSale: false };
    expect(() => saleLineAmounts({ ...base, quantity: 0 })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, quantity: -1 })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, quantity: 0.0001 })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, unitPrice: 1.5 })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, unitPrice: -1 })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, unitPrice: Number.NaN })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, unitCost: -0.5 })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, unitCost: Infinity })).toThrow(InvalidQuantityError);
    expect(() => saleLineAmounts({ ...base, quantity: 99_999_999, unitPrice: Number.MAX_SAFE_INTEGER })).toThrow(
      InvalidQuantityError,
    );
    expect(() => saleLineAmounts({ ...base, quantity: 1, unitPrice: 9_000_000_000_000, unitCost: 0 })).toThrow(
      InvalidQuantityError,
    );
  });

  it('matches the mobile formula (apps/mobile/db/sales.ts) when the cost is the same', () => {
    // mobile: profit = isCostSale ? 0 : (appliedPrice − costAtSale) × quantity, line = appliedPrice × quantity
    const rand = mulberry32(103);
    for (let run = 0; run < 500; run++) {
      const appliedPrice = Math.floor(rand() * 1_000_000);
      const costAtSale = Math.floor(rand() * 1_000_000);
      const isCostSale = rand() < 0.2;
      const integerQuantity = 1 + Math.floor(rand() * 50);
      const mobileProfit = isCostSale ? 0 : (appliedPrice - costAtSale) * integerQuantity;
      expect(saleLineAmounts({ quantity: integerQuantity, unitPrice: appliedPrice, unitCost: costAtSale, isCostSale })).toEqual({
        lineTotal: appliedPrice * integerQuantity,
        profit: mobileProfit + 0,
      });

      // fractional quantities: only the rounding of the line total to a minor unit differs
      const quantity = (1 + Math.floor(rand() * 20_000)) / 1000;
      const amounts = saleLineAmounts({ quantity, unitPrice: appliedPrice, unitCost: costAtSale, isCostSale });
      expect(Math.abs(amounts.lineTotal - appliedPrice * quantity)).toBeLessThanOrEqual(0.5 + 1e-6);
      const mobileFractional = isCostSale ? 0 : (appliedPrice - costAtSale) * quantity;
      expect(Math.abs(amounts.profit - mobileFractional)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});

describe('marginRatio', () => {
  it('is profit over sales with 4 decimals', () => {
    expect(marginRatio(2100, 7500)).toBe(0.28);
    expect(marginRatio(1, 3)).toBe(0.3333);
    expect(marginRatio(2, 3)).toBe(0.6667);
    expect(marginRatio(1148.148164, 3000)).toBe(0.3827);
  });

  it('rounds half away from zero, also for losses', () => {
    expect(marginRatio(1, 20000)).toBe(0.0001); // 0.00005
    expect(marginRatio(-1, 20000)).toBe(-0.0001);
    expect(marginRatio(-200, 1800)).toBe(-0.1111);
    expect(Object.is(marginRatio(0, 100), 0)).toBe(true);
    expect(Object.is(marginRatio(-0.000001, 100_000), 0)).toBe(true);
  });

  it('is null when there are no sales', () => {
    expect(marginRatio(0, 0)).toBeNull();
    expect(marginRatio(-5, 0)).toBeNull();
  });

  it('rejects invalid sales totals', () => {
    expect(() => marginRatio(1, -1)).toThrow(InvalidQuantityError);
    expect(() => marginRatio(1, 1.5)).toThrow(InvalidQuantityError);
    expect(() => marginRatio(Number.NaN, 10)).toThrow(InvalidQuantityError);
  });
});

describe('averageTicket', () => {
  it('rounds total sales over tickets to a minor unit, half up', () => {
    expect(averageTicket(10_000, 4)).toBe(2500);
    expect(averageTicket(10, 4)).toBe(3); // 2.5
    expect(averageTicket(10, 3)).toBe(3); // 3.33
    expect(averageTicket(11, 3)).toBe(4); // 3.67
    expect(averageTicket(0, 3)).toBe(0);
  });

  it('is null when there are no tickets', () => {
    expect(averageTicket(0, 0)).toBeNull();
  });

  it('rejects invalid inputs', () => {
    expect(() => averageTicket(10.5, 2)).toThrow(InvalidQuantityError);
    expect(() => averageTicket(-10, 2)).toThrow(InvalidQuantityError);
    expect(() => averageTicket(10, 1.5)).toThrow(InvalidQuantityError);
    expect(() => averageTicket(10, -1)).toThrow(InvalidQuantityError);
  });
});

describe('costValue', () => {
  it('values quantities at their cost (valued entries, inventory value), exactly and rounded once', () => {
    expect(costValue([])).toBe(0);
    expect(costValue([{ quantityDelta: 10, unitCost: 0.1 }, { quantityDelta: 20, unitCost: 0.2 }])).toBe(5);
    expect(costValue([{ quantityDelta: 0.333, unitCost: 33.333333 }])).toBe(11.1); // 11.099999889
  });

  it('is the rule lossValue applies', () => {
    const movements = [{ quantityDelta: -1.5, unitCost: 12.345678 }, { quantityDelta: -0.25, unitCost: 3 }];
    expect(lossValue(movements)).toBe(costValue(movements));
  });
});

describe('lossValue', () => {
  it('sums |quantity delta| × unit cost, like sumLossOutflowsValue in mobile', () => {
    expect(lossValue([])).toBe(0);
    expect(lossValue([{ quantityDelta: -2, unitCost: 150 }, { quantityDelta: -0.5, unitCost: 300 }])).toBe(450);
    expect(lossValue([{ quantityDelta: 3, unitCost: 100 }])).toBe(300);
  });

  it('keeps the cost fraction, rounded to 6 decimals once over the sum', () => {
    // 0.001 × 0.0005 = 0.0000005 each; three of them = 0.0000015 → 0.000002
    const tiny = { quantityDelta: -0.001, unitCost: 0.0005 };
    expect(lossValue([tiny, tiny, tiny])).toBe(0.000002);
    expect(lossValue([{ quantityDelta: -0.29, unitCost: 100.123456 }])).toBe(29.035802); // 29.03580224
  });

  it('matches a float reference sum within rounding', () => {
    const rand = mulberry32(5);
    for (let run = 0; run < 200; run++) {
      const movements = Array.from({ length: 1 + Math.floor(rand() * 10) }, () => ({
        quantityDelta: -(1 + Math.floor(rand() * 10_000)) / 1000,
        unitCost: Math.floor(rand() * 100_000_000) / 1000,
      }));
      const reference = movements.reduce((t, m) => t + Math.abs(m.quantityDelta) * m.unitCost, 0);
      expect(Math.abs(lossValue(movements) - reference)).toBeLessThanOrEqual(1e-6);
    }
  });

  it('rejects invalid movements', () => {
    expect(() => lossValue([{ quantityDelta: -1, unitCost: -1 }])).toThrow(InvalidQuantityError);
    expect(() => lossValue([{ quantityDelta: -0.0001, unitCost: 1 }])).toThrow(InvalidQuantityError);
    expect(() => lossValue([{ quantityDelta: -99_999_999, unitCost: 99_999_999 }])).toThrow(InvalidQuantityError);
  });
});

describe('isLowStock', () => {
  const product = { lowStockThreshold: null, category: null };

  it('is stock strictly below the product threshold', () => {
    expect(isLowStock(4, product)).toBe(true);
    expect(isLowStock(5, product)).toBe(false);
    expect(isLowStock(4.999, product)).toBe(true);
    expect(isLowStock(0, product)).toBe(true);
  });

  it('defaults the general threshold to 5', () => {
    expect(DEFAULT_LOW_STOCK_THRESHOLD).toBe(5);
    expect(isLowStock(9, product, 10)).toBe(true);
    expect(isLowStock(10, product, 10)).toBe(false);
  });

  it('uses the product and category thresholds like getProductThreshold', () => {
    expect(isLowStock(2, { lowStockThreshold: 2, category: 'Bebidas' })).toBe(false);
    expect(isLowStock(1, { lowStockThreshold: 2, category: 'Bebidas' })).toBe(true);
    expect(isLowStock(23, { lowStockThreshold: null, category: 'Bebidas' })).toBe(true);
    expect(isLowStock(24, { lowStockThreshold: null, category: 'Bebidas' })).toBe(false);
    expect(isLowStock(0, { lowStockThreshold: 0, category: null })).toBe(false);
  });
});
