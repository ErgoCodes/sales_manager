import { describe, expect, it } from 'vitest';
import { counterpartName, DOCUMENT_KIND_LABELS, formatAverageCost, formatQuantity, formatSignedQuantity, MOVEMENT_KIND_LABELS } from '../format';

describe('inventory formatting', () => {
  it('formats quantities with up to 3 decimals, with a sign for deltas', () => {
    expect(formatQuantity(1234.5)).toMatch(/^1\D?234[.,]5$/);
    expect(formatQuantity(0.125)).toMatch(/0[.,]125/);
    expect(formatSignedQuantity(2)).toBe('+2');
    expect(formatSignedQuantity(-0.5)).toMatch(/^-0[.,]5$/);
  });

  it('never renders a hidden average cost as zero', () => {
    expect(formatAverageCost(null)).toBe('—');
    expect(formatAverageCost({ amount: 8050.5, currency: 'CUP' })).toBe('$80.51 CUP');
  });

  it('labels every movement kind in Spanish', () => {
    expect(MOVEMENT_KIND_LABELS.transfer_out).toMatch(/Transferencia/);
    expect(Object.values(MOVEMENT_KIND_LABELS).every((l) => l.length > 0)).toBe(true);
    expect(MOVEMENT_KIND_LABELS.sale).toBe('Venta');
    expect(DOCUMENT_KIND_LABELS.sale).toBe('Venta');
  });

  it('masks the other location of a transfer as "Otro punto"', () => {
    expect(counterpartName({ kind: 'transfer_out', counterpartLocationName: null })).toBe('Otro punto');
    expect(counterpartName({ kind: 'transfer_in', counterpartLocationName: 'Norte' })).toBe('Norte');
    expect(counterpartName({ kind: 'entry', counterpartLocationName: null })).toBe('—');
  });
});
