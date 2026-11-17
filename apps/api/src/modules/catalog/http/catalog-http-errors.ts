import { HttpStatus } from '@nestjs/common';

import type { MappedError } from '../../../common/http/all-exceptions.filter';
import { CurrencyMismatch, InvalidCatalogValue, ProductArchived } from '../domain/catalog-errors';

/**
 * Catalog domain errors -> `ErrorResponse`, registered next to the IAM mapper in
 * `EXCEPTION_MAPPERS`. 403 and 404 stay with the IAM errors (`PermissionDenied`,
 * `ResourceNotFound`): generic, never saying which rule or tenant.
 */
export function toCatalogDomainError(error: unknown): MappedError | null {
  if (error instanceof ProductArchived) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'ARCHIVED', message: error.message } } };
  }
  if (error instanceof CurrencyMismatch) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, body: { error: { code: 'CURRENCY_MISMATCH', message: error.message } } };
  }
  if (error instanceof InvalidCatalogValue) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ path: error.path, message: error.message }] } },
    };
  }
  return null;
}
