import { z } from 'zod';

import { CURRENCIES, IsoDateTime, Money, Paginated, Uuid } from '../common';

const Currency = z.enum(CURRENCIES);
const name = z.string().trim().min(1).max(200);
// Allowed values come from @monaco/domain (UNITS_OF_MEASURE / CATEGORIES); the API validates them (T4).
const unitOfMeasure = z.string().trim().min(1).max(32);
const category = z.string().trim().min(1).max(64);
const lowStockThreshold = z.number().nonnegative().refine(Number.isFinite).pipe(z.number().max(99_999_999_999.999));
const expirationDate = z.iso.date();

export const Product = z
  .object({
    id: Uuid,
    name: z.string(),
    unitOfMeasure: z.string(),
    category: z.string().nullable(),
    currency: Currency,
    costPrice: Money.nullable().meta({ description: 'Null when hidden (no catalog:write) or unset' }),
    cashPrice: Money.nullable(),
    transferPrice: Money.nullable(),
    lowStockThreshold: z.number().nullable(),
    expirationDate: z.string().nullable(),
    archivedAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .meta({ id: 'Product' });
export type Product = z.infer<typeof Product>;

export const ProductWithLocationPrice = Product.extend({
  effectiveCashPrice: Money.nullable().meta({ description: 'Location override, else base price' }),
  effectiveTransferPrice: Money.nullable(),
  cashPriceOverride: Money.nullable(),
  transferPriceOverride: Money.nullable(),
}).meta({ id: 'ProductWithLocationPrice' });
export type ProductWithLocationPrice = z.infer<typeof ProductWithLocationPrice>;

export const PaginatedProducts = Paginated(ProductWithLocationPrice, 'PaginatedProducts');

export const CreateProductRequest = z
  .strictObject({
    name,
    unitOfMeasure,
    category: category.nullable().optional(),
    currency: Currency,
    costPrice: Money.nullable().optional(),
    cashPrice: Money.nullable().optional(),
    transferPrice: Money.nullable().optional(),
    lowStockThreshold: lowStockThreshold.nullable().optional(),
    expirationDate: expirationDate.nullable().optional(),
  })
  .meta({ id: 'CreateProductRequest' });
export type CreateProductRequest = z.infer<typeof CreateProductRequest>;

export const UpdateProductRequest = z
  .strictObject({
    name: name.optional(),
    unitOfMeasure: unitOfMeasure.optional(),
    category: category.nullable().optional(),
    currency: Currency.optional(),
    costPrice: Money.nullable().optional(),
    cashPrice: Money.nullable().optional(),
    transferPrice: Money.nullable().optional(),
    lowStockThreshold: lowStockThreshold.nullable().optional(),
    expirationDate: expirationDate.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'At least one field is required')
  .meta({ id: 'UpdateProductRequest' });
export type UpdateProductRequest = z.infer<typeof UpdateProductRequest>;

export const SetLocationPriceRequest = z
  .strictObject({
    cashPrice: Money.nullable().meta({ description: 'Null removes the override' }),
    transferPrice: Money.nullable().meta({ description: 'Null removes the override' }),
  })
  .meta({ id: 'SetLocationPriceRequest' });
export type SetLocationPriceRequest = z.infer<typeof SetLocationPriceRequest>;

export const ListProductsQuery = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    category: category.optional(),
    includeArchived: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    locationId: Uuid.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z
      .union([z.string().regex(/^\d+$/).transform(Number), z.number()])
      .pipe(z.int().min(1).max(100))
      .default(50),
  })
  .meta({ id: 'ListProductsQuery' });
export type ListProductsQuery = z.infer<typeof ListProductsQuery>;

/** Path parameters of `PUT /locations/:locationId/products/:productId/price`. */
export const LocationProductParams = z.object({ locationId: Uuid, productId: Uuid }).meta({ id: 'LocationProductParams' });
export type LocationProductParams = z.infer<typeof LocationProductParams>;

export const ProductLocationQuery = z.object({ locationId: Uuid.optional() }).meta({ id: 'ProductLocationQuery' });
export type ProductLocationQuery = z.infer<typeof ProductLocationQuery>;

