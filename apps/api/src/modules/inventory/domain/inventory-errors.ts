/**
 * Typed errors of the inventory module. The domain knows nothing about HTTP;
 * `http/inventory-http-errors.ts` maps them (SP3 spec, "Errores"):
 *
 * | Error                | HTTP | code                  |
 * |----------------------|------|-----------------------|
 * | `InsufficientStock`  | 409  | `INSUFFICIENT_STOCK`  |
 * | `IdempotencyConflict`| 409  | `IDEMPOTENCY_CONFLICT`|
 * | `AlreadyReversed`    | 409  | `ALREADY_REVERSED`    |
 * | `ArchivedResource`   | 409  | `ARCHIVED`            |
 * | `CurrencyMismatch`   | 422  | `CURRENCY_MISMATCH`   |
 * | `FutureOccurredAt`   | 400  | `VALIDATION_ERROR`    |
 */
export abstract class InventoryDomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** One product of the document that would end below zero. Only pairs the actor is allowed to touch. */
export interface StockShortage {
  readonly productId: string;
  /** Stock right before the movement that failed (major units). */
  readonly available: number;
  /** Missing quantity to keep the stock at zero. */
  readonly shortBy: number;
}

export class InsufficientStock extends InventoryDomainError {
  readonly code = 'INSUFFICIENT_STOCK';

  constructor(readonly shortages: readonly StockShortage[]) {
    super('Insufficient stock');
  }
}

/** Same id with another content, or an id that belongs to another tenant (indistinguishable on purpose). */
export class IdempotencyConflict extends InventoryDomainError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor() {
    super('The id was already used for a different document');
  }
}

/** The document was already reversed (once is the limit, D8), or it is itself a reversal. */
export class AlreadyReversed extends InventoryDomainError {
  readonly code = 'ALREADY_REVERSED';

  constructor() {
    super('The document was already reversed or is a reversal');
  }
}

export class ArchivedResource extends InventoryDomainError {
  readonly code = 'ARCHIVED';

  constructor(readonly resource: 'product' | 'location') {
    super(`The ${resource} is archived`);
  }
}

export class CurrencyMismatch extends InventoryDomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(readonly productId: string) {
    super('The unit cost currency differs from the product currency');
  }
}

/** `occurredAt` is the business date the user reports: it cannot be in the future (D13). */
export class FutureOccurredAt extends InventoryDomainError {
  readonly code = 'future_occurred_at';

  constructor() {
    super('occurredAt cannot be in the future');
  }
}
