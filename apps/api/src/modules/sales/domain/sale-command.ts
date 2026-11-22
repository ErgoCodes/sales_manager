import { IsoDateTime, MAX_DOCUMENT_LINES, Money, Quantity, Uuid } from '@monaco/contracts';
import { PAYMENT_METHODS } from '@monaco/domain';
import { z } from 'zod';

/** numeric(5,2) between 0 and 100. */
const DiscountPercent = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimals');

export const SaleLineCommand = z.strictObject({
  productId: Uuid,
  quantity: Quantity,
  /** The applied unit price, discount already included (SP4 spec): `line_total = round(quantity × unitPrice)`. */
  unitPrice: Money,
  /** Only records the discount given; it is not applied again. */
  discountPercent: DiscountPercent,
  paymentMethod: z.enum(PAYMENT_METHODS),
  isCostSale: z.boolean(),
});

/**
 * The command of `RecordSale`. It lives in the API until SP5 exposes the use case
 * over HTTP and moves it to `packages/contracts` (no route writes sales in SP4).
 * `id` comes from the client and is also the id of the sale's inventory document.
 * Like every ledger document: 1..100 lines and no repeated product.
 */
export const RecordSaleCommand = z.strictObject({
  id: Uuid,
  locationId: Uuid,
  occurredAt: IsoDateTime.optional(),
  lines: z
    .array(SaleLineCommand)
    .min(1)
    .max(MAX_DOCUMENT_LINES)
    .refine((items) => new Set(items.map((l) => l.productId)).size === items.length, 'A product may appear only once per sale'),
});
export type RecordSaleCommand = z.infer<typeof RecordSaleCommand>;
export type SaleLineCommand = z.infer<typeof SaleLineCommand>;

/** The command does not satisfy `RecordSaleCommand`; nothing was read or written. */
export class InvalidSaleCommand extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    super('Invalid sale command');
    this.name = 'InvalidSaleCommand';
  }
}
