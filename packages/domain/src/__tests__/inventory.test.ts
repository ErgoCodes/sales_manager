import { describe, expect, it } from 'vitest';
import {
  INVENTORY_MOVEMENT_KINDS,
  InsufficientStockError,
  InvalidQuantityError,
  UnknownMovementKindError,
  LEGACY_MOVEMENT_KIND,
  addQuantities,
  assertStockNotNegative,
  averageCostAfterEntry,
  averageCostAfterTransferIn,
  calculateTransferPrice,
  calculateTransferPriceMinor,
  deriveStock,
  fromMinorUnits,
  fromThousandths,
  blendsAverageCost,
  movementDelta,
  replayAverageCost,
  toMinorUnits,
  toThousandths,
  type InventoryMovementKind,
  type LedgerLine,
} from '../index';

describe('movementDelta', () => {
  it('fixes the sign by kind', () => {
    expect(movementDelta('entry', 2.5)).toBe(2.5);
    expect(movementDelta('transfer_in', 1)).toBe(1);
    expect(movementDelta('shrinkage', 2)).toBe(-2);
    expect(movementDelta('owner_withdrawal', 0.3)).toBe(-0.3);
    expect(movementDelta('transfer_out', 4)).toBe(-4);
    expect(movementDelta('sale', 1.25)).toBe(-1.25);
  });

  it('keeps the sign of adjustment and reversal', () => {
    expect(movementDelta('adjustment', -3)).toBe(-3);
    expect(movementDelta('adjustment', 3)).toBe(3);
    expect(movementDelta('reversal', -1.5)).toBe(-1.5);
    expect(movementDelta('reversal', 1.5)).toBe(1.5);
  });

  it('rejects zero, negative on fixed-sign kinds, NaN and more than 3 decimals', () => {
    expect(() => movementDelta('adjustment', 0)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('reversal', 0)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('entry', 0)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('entry', -1)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('shrinkage', -1)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('sale', -1)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('sale', 0)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('entry', Number.NaN)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('entry', Infinity)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('entry', 0.0001)).toThrow(InvalidQuantityError);
  });

  it('never returns negative zero and rounds representation noise', () => {
    expect(Object.is(movementDelta('adjustment', 0.1 + 0.2), 0.3)).toBe(true);
  });

  it('lists every kind', () => {
    expect(INVENTORY_MOVEMENT_KINDS).toEqual([
      'entry', 'shrinkage', 'owner_withdrawal', 'adjustment', 'transfer_out', 'transfer_in', 'reversal', 'sale',
    ]);
  });
});

describe('movementDelta hardening', () => {
  it('rejects unknown kinds', () => {
    expect(() => movementDelta('bogus' as InventoryMovementKind, 5)).toThrow(UnknownMovementKindError);
  });
});

describe('toThousandths bounds', () => {
  it('accepts the numeric(14,3) limit and rejects beyond it', () => {
    expect(toThousandths(99_999_999_999.999)).toBe(99_999_999_999_999);
    expect(toThousandths(-99_999_999_999.999)).toBe(-99_999_999_999_999);
    expect(() => toThousandths(100_000_000_000)).toThrow(InvalidQuantityError);
    expect(() => toThousandths(-100_000_000_000)).toThrow(InvalidQuantityError);
    expect(() => movementDelta('entry', 1e300)).toThrow(InvalidQuantityError);
  });
});

describe('LEGACY_MOVEMENT_KIND', () => {
  it('maps mobile types', () => {
    expect(LEGACY_MOVEMENT_KIND).toEqual({
      entrada: 'entry', merma: 'shrinkage', retiro_owner: 'owner_withdrawal', ajuste: 'adjustment',
    });
  });
});

describe('thousandths arithmetic', () => {
  it('converts and back', () => {
    expect(toThousandths(0.1 + 0.2)).toBe(300);
    expect(toThousandths(-1.234)).toBe(-1234);
    expect(fromThousandths(1234)).toBe(1.234);
    expect(() => toThousandths(1.2345)).toThrow(InvalidQuantityError);
    expect(() => toThousandths(Number.NaN)).toThrow(InvalidQuantityError);
  });

  it('adds without float drift', () => {
    expect(addQuantities(0.1, 0.2)).toBe(0.3);
    expect(addQuantities(0.3, -0.3)).toBe(0);
  });
});

describe('assertStockNotNegative', () => {
  it('returns the resulting stock', () => {
    expect(assertStockNotNegative(1, [2, -3])).toBe(0);
    expect(assertStockNotNegative(0, [])).toBe(0);
  });

  it('accepts 0.1 + 0.2 - 0.3 exactly', () => {
    expect(assertStockNotNegative(0, [0.1, 0.2, -0.3])).toBe(0);
  });

  it('throws with the offending context', () => {
    try {
      assertStockNotNegative(1, [-1.001]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientStockError);
      expect((error as InsufficientStockError).available).toBe(1);
      expect((error as InsufficientStockError).shortBy).toBe(0.001);
    }
  });

  it('rejects a negative prefix even if the total recovers', () => {
    expect(() => assertStockNotNegative(0, [-1, 2])).toThrow(InsufficientStockError);
  });

  it('rejects a negative current stock', () => {
    expect(() => assertStockNotNegative(-1, [])).toThrow(InsufficientStockError);
  });
});

describe('average cost', () => {
  it('averageCostAfterEntry blends with the current stock', () => {
    expect(averageCostAfterEntry(10, 100, 10, 200)).toBe(150);
    expect(averageCostAfterEntry(0, 0, 5, 80)).toBe(80);
    expect(averageCostAfterEntry(-2, 100, 5, 80)).toBe(80);
  });

  it('averageCostAfterTransferIn blends the source cost into the destination', () => {
    expect(averageCostAfterTransferIn(10, 100, 10, 200)).toBe(150);
    expect(averageCostAfterTransferIn(0, 0, 3, 90)).toBe(90);
  });

  const line = (over: Partial<LedgerLine> & Pick<LedgerLine, 'documentId' | 'kind' | 'quantityDelta'>): LedgerLine => ({
    unitCost: 0,
    reversesDocumentId: null,
    ...over,
  });

  it('replay equals the incremental projection without reversals', () => {
    const ledger: LedgerLine[] = [
      line({ documentId: 'a', kind: 'entry', quantityDelta: 10, unitCost: 100 }),
      line({ documentId: 'b', kind: 'shrinkage', quantityDelta: -4 }),
      line({ documentId: 'c', kind: 'transfer_in', quantityDelta: 6, unitCost: 130 }),
      line({ documentId: 'd', kind: 'adjustment', quantityDelta: -12 }),
      line({ documentId: 'e', kind: 'entry', quantityDelta: 2, unitCost: 50 }),
    ];
    let stock = 0;
    let avg = 0;
    for (const l of ledger) {
      if (l.kind === 'entry' || l.kind === 'transfer_in') avg = averageCostAfterEntry(stock, avg, l.quantityDelta, l.unitCost);
      stock = addQuantities(stock, l.quantityDelta);
    }
    expect(replayAverageCost(ledger)).toBe(avg);
  });

  it('excludes reverted documents and their reversals', () => {
    const ledger: LedgerLine[] = [
      line({ documentId: 'a', kind: 'entry', quantityDelta: 10, unitCost: 100 }),
      line({ documentId: 'b', kind: 'transfer_in', quantityDelta: 10, unitCost: 300 }),
      line({ documentId: 'r', kind: 'reversal', quantityDelta: -10, reversesDocumentId: 'b' }),
    ];
    expect(replayAverageCost(ledger)).toBe(100);
  });

  it('returns 0 for an empty or fully reverted ledger', () => {
    expect(replayAverageCost([])).toBe(0);
    expect(
      replayAverageCost([
        line({ documentId: 'a', kind: 'entry', quantityDelta: 1, unitCost: 9 }),
        line({ documentId: 'r', kind: 'reversal', quantityDelta: -1, reversesDocumentId: 'a' }),
      ]),
    ).toBe(0);
  });

  it('uses the stock at each point, not the entry totals', () => {
    const ledger: LedgerLine[] = [
      line({ documentId: 'a', kind: 'entry', quantityDelta: 10, unitCost: 100 }),
      line({ documentId: 'b', kind: 'owner_withdrawal', quantityDelta: -10 }),
      line({ documentId: 'c', kind: 'entry', quantityDelta: 5, unitCost: 40 }),
    ];
    expect(replayAverageCost(ledger)).toBe(40);
  });

  it('only entries and incoming transfers blend the average cost', () => {
    const blending = INVENTORY_MOVEMENT_KINDS.filter((kind) => blendsAverageCost(kind));
    expect(blending).toEqual(['entry', 'transfer_in']);
  });

  it('reverting a transfer_in leaves the destination as if it never happened', () => {
    const ledger: LedgerLine[] = [
      line({ documentId: 'a', kind: 'entry', quantityDelta: 10, unitCost: 100 }),
      line({ documentId: 't', kind: 'transfer_in', quantityDelta: 10, unitCost: 300 }),
      line({ documentId: 'b', kind: 'entry', quantityDelta: 10, unitCost: 100 }),
      line({ documentId: 'r', kind: 'reversal', quantityDelta: -10, unitCost: 300, reversesDocumentId: 't' }),
    ];
    expect(replayAverageCost(ledger)).toBe(100);
  });
});

describe('minor units', () => {
  it('converts with default exponent 2', () => {
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(1.005)).toBe(101);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(fromMinorUnits(1999)).toBe(19.99);
  });

  it('keeps full precision for large amounts and rejects unsafe ones', () => {
    expect(toMinorUnits(12345678901.23)).toBe(1234567890123);
    expect(toMinorUnits(90071992547409.9)).toBe(9007199254740990);
    expect(() => toMinorUnits(90071992547410)).toThrow(InvalidQuantityError);
    expect(() => toMinorUnits(1e300)).toThrow(InvalidQuantityError);
    expect(() => toMinorUnits(-1e300)).toThrow(InvalidQuantityError);
  });

  it('rounds half away from zero symmetrically', () => {
    expect(toMinorUnits(2.505)).toBe(251);
    expect(toMinorUnits(-2.505)).toBe(-251);
    expect(toMinorUnits(-0.005)).toBe(-1);
    expect(toMinorUnits(0.004)).toBe(0);
    expect(Object.is(toMinorUnits(-0.004), 0)).toBe(true);
    expect(toMinorUnits(1e-7)).toBe(0);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(1.5, 0)).toBe(2);
    expect(toMinorUnits(-1.5, 0)).toBe(-2);
    expect(toMinorUnits(1.2e-3, 0)).toBe(0);
  });

  it('supports other exponents and rejects non-finite', () => {
    expect(toMinorUnits(5, 0)).toBe(5);
    expect(fromMinorUnits(1234, 3)).toBe(1.234);
    expect(() => toMinorUnits(Number.NaN)).toThrow(InvalidQuantityError);
    expect(() => toMinorUnits(1, -1)).toThrow(InvalidQuantityError);
  });

  it('calculateTransferPriceMinor matches the major-units function', () => {
    for (const cash of [100, 123.45, 999.99, 0]) {
      expect(calculateTransferPriceMinor(toMinorUnits(cash))).toBe(toMinorUnits(calculateTransferPrice(cash)));
    }
    expect(calculateTransferPriceMinor(toMinorUnits(100), 20)).toBe(toMinorUnits(120));
  });

  it('keeps calculateTransferPrice behavior', () => {
    expect(calculateTransferPrice(100)).toBe(110);
    expect(calculateTransferPrice(103, 0)).toBe(105);
  });
});

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ledger properties', () => {
  const legacyEntries = Object.entries(LEGACY_MOVEMENT_KIND) as [string, InventoryMovementKind][];
  const randomQty = (rand: () => number) => Math.round(rand() * 20000) / 1000 + 0.001;

  it('sum of movementDelta equals deriveStock for legacy-mapped kinds', () => {
    const rand = mulberry32(42);
    for (let run = 0; run < 200; run++) {
      const movements: { type: string; quantity: number; kind: InventoryMovementKind }[] = [];
      const n = 1 + Math.floor(rand() * 15);
      for (let i = 0; i < n; i++) {
        const [type, kind] = legacyEntries[Math.floor(rand() * legacyEntries.length)];
        movements.push({ type, kind, quantity: randomQty(rand) });
      }
      const ledgerSum = fromThousandths(
        movements.reduce((t, m) => t + toThousandths(movementDelta(m.kind, m.quantity)), 0),
      );
      expect(toThousandths(deriveStock(movements, 0))).toBe(toThousandths(ledgerSum));
    }
  });

  it('matches an independent reference sum for transfer_in and reversal', () => {
    const rand = mulberry32(7);
    for (let run = 0; run < 100; run++) {
      let ref = 0;
      let got = 0;
      for (let i = 0; i < 10; i++) {
        const q = randomQty(rand);
        if (rand() < 0.5) {
          got += toThousandths(movementDelta('transfer_in', q));
          ref += Math.round(q * 1000);
        } else {
          const signed = rand() < 0.5 ? q : -q;
          got += toThousandths(movementDelta('reversal', signed));
          ref += Math.round(signed * 1000);
        }
      }
      expect(got).toBe(ref);
    }
  });

  it('a sale lowers the stock by its quantity and never changes the average cost', () => {
    const rand = mulberry32(2026);
    for (let run = 0; run < 200; run++) {
      const ledger: LedgerLine[] = [];
      let stock = 0;
      for (let i = 0; i < 1 + Math.floor(rand() * 10); i++) {
        const q = randomQty(rand);
        if (stock > 0 && rand() < 0.5) {
          const sold = Math.min(q, fromThousandths(stock));
          ledger.push({ documentId: `s${i}`, kind: 'sale', quantityDelta: movementDelta('sale', sold), unitCost: 0, reversesDocumentId: null });
          stock -= toThousandths(sold);
        } else {
          ledger.push({ documentId: `e${i}`, kind: 'entry', quantityDelta: movementDelta('entry', q), unitCost: 1 + Math.floor(rand() * 500), reversesDocumentId: null });
          stock += toThousandths(q);
        }
      }
      const before = replayAverageCost(ledger);
      const sold = Math.max(1, Math.floor(stock / 2)) / 1000;
      const delta = movementDelta('sale', sold);
      expect(toThousandths(delta)).toBe(-toThousandths(sold));
      ledger.push({ documentId: 'last', kind: 'sale', quantityDelta: delta, unitCost: before, reversesDocumentId: null });
      expect(replayAverageCost(ledger)).toBe(before);
    }
  });

  it('no accepted sequence leaves a negative prefix', () => {
    const rand = mulberry32(99);
    let accepted = 0;
    let rejected = 0;
    for (let run = 0; run < 300; run++) {
      const start = Math.round(rand() * 5000) / 1000;
      const deltas = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => {
        const q = Math.max(1, Math.round((randomQty(rand) * 1000) / 4)) / 1000;
        return rand() < 0.5 ? q : -q;
      });
      try {
        assertStockNotNegative(start, deltas);
        accepted++;
        let running = toThousandths(start);
        for (const d of deltas) {
          running += toThousandths(d);
          expect(running).toBeGreaterThanOrEqual(0);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientStockError);
        rejected++;
        let running = toThousandths(start);
        const prefixes = deltas.map((d) => (running += toThousandths(d)));
        expect(Math.min(...prefixes)).toBeLessThan(0);
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });
});
