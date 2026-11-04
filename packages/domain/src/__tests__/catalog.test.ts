import { describe, expect, it } from 'vitest';
import { CATEGORY_OPTIONS, getProductThreshold } from '../catalog';

describe('getProductThreshold', () => {
  it('prefers the product own threshold', () => {
    expect(getProductThreshold({ lowStockThreshold: 3, category: 'Bebidas' }, 10)).toBe(3);
  });
  it('falls back to the category threshold', () => {
    expect(getProductThreshold({ lowStockThreshold: null, category: 'Bebidas' }, 10)).toBe(24);
  });
  it('falls back to the general threshold', () => {
    expect(getProductThreshold({ lowStockThreshold: null, category: 'Snacks' }, 10)).toBe(10);
    expect(getProductThreshold({ lowStockThreshold: null, category: null }, 10)).toBe(10);
  });
  it('exposes category options', () => {
    expect(CATEGORY_OPTIONS[0]).toEqual({ label: 'Bebidas', value: 'Bebidas' });
  });
});
