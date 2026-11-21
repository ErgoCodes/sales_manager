import { HttpStatus } from '@nestjs/common';
import type { ExceptionMapper } from '../../../common/http/all-exceptions.filter';
import {
  ArchivedResource,
  CurrencyMismatch,
  FutureOccurredAt,
  IdempotencyConflict,
  InsufficientStock,
} from '../domain/inventory-errors';

/** Deadlock (40P01) and serialization failure (40001): not expected given the lock order, never a 500. */
const CONFLICT_SQLSTATES = new Set(['40P01', '40001']);

function sqlState(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = typeof candidate === 'object' && candidate !== null ? (candidate as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/**
 * Inventory domain errors (and the lock conflicts) -> `ErrorResponse` (spec "Errores").
 * `INSUFFICIENT_STOCK` lists only products of the document itself, which the
 * actor is already allowed to touch: `path` is the product id.
 */
export const toInventoryMappedError: ExceptionMapper = (error) => {
  if (error instanceof InsufficientStock) {
    return {
      status: HttpStatus.CONFLICT,
      body: {
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: 'Insufficient stock',
          details: error.shortages.map((s) => ({ path: s.productId, message: `Available ${s.available}, short by ${s.shortBy}` })),
        },
      },
    };
  }
  if (error instanceof IdempotencyConflict) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'IDEMPOTENCY_CONFLICT', message: error.message } } };
  }
  if (error instanceof ArchivedResource) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'ARCHIVED', message: error.message } } };
  }
  if (error instanceof CurrencyMismatch) {
    return { status: HttpStatus.UNPROCESSABLE_ENTITY, body: { error: { code: 'CURRENCY_MISMATCH', message: error.message } } };
  }
  if (error instanceof FutureOccurredAt) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ path: 'occurredAt', message: error.message }] } },
    };
  }
  const state = sqlState(error);
  if (state && CONFLICT_SQLSTATES.has(state)) {
    return { status: HttpStatus.CONFLICT, body: { error: { code: 'CONFLICT', message: 'Conflict' } } };
  }
  return null;
};
