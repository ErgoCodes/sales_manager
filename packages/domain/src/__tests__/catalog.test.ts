import { describe, expect, it } from 'vitest';
import { CATEGORY_OPTIONS, getProductThreshold, isCategory, isUnitOfMeasure } from '../catalog';

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

describe('isUnitOfMeasure / isCategory', () => {
  it('accept only the catalog values', () => {
    expect(isUnitOfMeasure('kg')).toBe(true);
    expect(isUnitOfMeasure('Kg')).toBe(false);
    expect(isUnitOfMeasure('')).toBe(false);
    expect(isCategory('Bebidas')).toBe(true);
    expect(isCategory('bebidas')).toBe(false);
    expect(isCategory('Nope')).toBe(false);
  });
});
