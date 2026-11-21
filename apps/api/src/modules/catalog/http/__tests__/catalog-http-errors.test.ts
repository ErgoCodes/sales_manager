import { describe, expect, it } from 'vitest';

import { CurrencyMismatch, InvalidCatalogValue, ProductArchived } from '../../domain/catalog-errors';
import { toCatalogDomainError } from '../catalog-http-errors';

describe('toCatalogDomainError', () => {
  it('maps ARCHIVED to 409, CURRENCY_MISMATCH to 422 and a bad catalog value to a 400 validation error', () => {
    expect(toCatalogDomainError(new ProductArchived())).toMatchObject({ status: 409, body: { error: { code: 'ARCHIVED' } } });
    expect(toCatalogDomainError(new CurrencyMismatch('has_movements'))).toMatchObject({ status: 422, body: { error: { code: 'CURRENCY_MISMATCH' } } });
    expect(toCatalogDomainError(new InvalidCatalogValue('category', 'Unknown category'))).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ path: 'category', message: 'Unknown category' }] } },
    });
  });

  it('leaves every other error to the next mapper', () => {
    expect(toCatalogDomainError(new Error('x'))).toBeNull();
  });
});
