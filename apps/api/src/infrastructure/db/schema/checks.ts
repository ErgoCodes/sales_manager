import { sql } from 'drizzle-orm';

/** `column in ('a', 'b')` for a CHECK generated from a catalog; single quotes in values are escaped. */
export const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')})`);
