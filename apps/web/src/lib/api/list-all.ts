import type { ApiResult } from './admin';

/** Collects every page of a cursor-paginated list (bounded by `maxPages`), for selectors that need all rows. */
export async function listAll<T>(fetchPage: (cursor?: string) => Promise<ApiResult<{ items: T[]; nextCursor: string | null }>>, maxPages = 10): Promise<ApiResult<T[]>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    if (!result.ok) return result;
    items.push(...result.data.items);
    if (!result.data.nextCursor) break;
    cursor = result.data.nextCursor;
  }
  return { ok: true, data: items };
}
