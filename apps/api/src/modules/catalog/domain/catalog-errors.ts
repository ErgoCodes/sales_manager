import { IamDomainError } from '../../iam/domain/errors';

/**
 * Typed catalog errors (SP3·T4), mapped to HTTP by `catalog-http-errors.ts`:
 *
 * | Error                 | HTTP | code               |
 * |-----------------------|------|--------------------|
 * | `ProductArchived`     | 409  | `ARCHIVED`         |
 * | `CurrencyMismatch`    | 422  | `CURRENCY_MISMATCH`|
 * | `InvalidCatalogValue` | 400  | `VALIDATION_ERROR` |
 */

/** The product is archived and the operation does not allow that (a price override). */
export class ProductArchived extends IamDomainError {
  readonly code = 'archived';

  constructor() {
    super('The product is archived');
  }
}

/** A price or cost is not in the product's currency, or the currency cannot change any more. */
export class CurrencyMismatch extends IamDomainError {
  readonly code = 'currency_mismatch';

  constructor(readonly reason: 'amount_currency' | 'has_movements') {
    super(reason === 'has_movements' ? 'The currency cannot change once the product has movements' : 'The amount is not in the product currency');
  }
}

/** A value the contract cannot express: the unit of measure or the category is not in the catalog lists. */
export class InvalidCatalogValue extends IamDomainError {
  readonly code = 'invalid_catalog_value';

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
