import { z } from 'zod';

/** Query params for cursor pagination. */
export const PaginationQuery = z
  .object({
    cursor: z.string().min(1).max(512).optional().meta({ description: 'Opaque cursor from a previous page' }),
    limit: z
      .union([
        z.string().regex(/^\d+$/).transform(Number),
        z.number(),
      ])
      .pipe(z.int().min(1).max(100))
      .default(50),
  })
  .meta({ id: 'PaginationQuery' });
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/**
 * Builds a cursor-paginated response schema. `id` is required so that every
 * instantiation gets its own component name in OpenAPI (e.g. 'PaginatedProducts').
 */
export function Paginated<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable().meta({ description: 'Null when there are no more pages' }),
    })
    .meta({ id });
}
export type Paginated<T> = { items: T[]; nextCursor: string | null };
