import { describe, expect, it } from 'vitest';
import { emptyProductForm, productFormFromProduct, validateLocationPriceForm, validateProductForm } from '../product-form';

const valid = { ...emptyProductForm(), name: ' Arroz ', unitOfMeasure: 'kg', category: 'Granos', currency: 'CUP', cashPrice: '100', transferPrice: '110', costPrice: '80.5' };

describe('validateProductForm', () => {
  it('builds a contract body in minor units with the chosen currency', () => {
    const result = validateProductForm({ ...valid, lowStockThreshold: '2.5', expirationDate: '2027-01-31' });
    expect(result).toEqual({
      ok: true,
      body: {
        name: 'Arroz',
        unitOfMeasure: 'kg',
        category: 'Granos',
        currency: 'CUP',
        costPrice: { amount: 8050, currency: 'CUP' },
        cashPrice: { amount: 10000, currency: 'CUP' },
        transferPrice: { amount: 11000, currency: 'CUP' },
        lowStockThreshold: 2.5,
        expirationDate: '2027-01-31',
      },
    });
  });

  it('sends empty optional fields as null', () => {
    const result = validateProductForm({ ...valid, category: '', cashPrice: '', transferPrice: '', costPrice: '' });
    expect(result.ok && result.body).toMatchObject({ category: null, cashPrice: null, transferPrice: null, costPrice: null, lowStockThreshold: null, expirationDate: null });
  });

  it('omits the cost when the field was not rendered (cost hidden), so it is never cleared by accident', () => {
    const result = validateProductForm({ ...valid, costPrice: undefined });
    expect(result.ok).toBe(true);
    expect(result.ok && 'costPrice' in result.body).toBe(false);
  });

  it('reports one Spanish error per invalid field', () => {
    const result = validateProductForm({ ...valid, name: '  ', unitOfMeasure: 'gramos', category: 'Juguetes', currency: 'EUR', cashPrice: 'abc', transferPrice: '1.234', costPrice: '-1', lowStockThreshold: '-2', expirationDate: '31/01/2027' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['cashPrice', 'category', 'costPrice', 'currency', 'expirationDate', 'lowStockThreshold', 'name', 'transferPrice', 'unitOfMeasure']);
    expect(result.errors.name).toMatch(/nombre/);
    expect(result.errors.cashPrice).toMatch(/importe/);
  });
});

describe('productFormFromProduct', () => {
  it('turns a product into editable strings, keeping hidden costs out of the form', () => {
    const form = productFormFromProduct(
      { name: 'Arroz', unitOfMeasure: 'kg', category: null, currency: 'USD', costPrice: null, cashPrice: { amount: 1250, currency: 'USD' }, transferPrice: null, lowStockThreshold: 3, expirationDate: null },
      { showCost: false },
    );
    expect(form).toEqual({ name: 'Arroz', unitOfMeasure: 'kg', category: '', currency: 'USD', costPrice: undefined, cashPrice: '12.50', transferPrice: '', lowStockThreshold: '3', expirationDate: '' });
  });
});

describe('validateLocationPriceForm', () => {
  it('builds the override body in the product currency, with empty meaning "remove override"', () => {
    expect(validateLocationPriceForm({ cashPrice: '20', transferPrice: '' }, 'MLC')).toEqual({ ok: true, body: { cashPrice: { amount: 2000, currency: 'MLC' }, transferPrice: null } });
  });

  it('rejects invalid amounts', () => {
    const result = validateLocationPriceForm({ cashPrice: 'x', transferPrice: '1.001' }, 'CUP');
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['cashPrice', 'transferPrice']);
  });
});
