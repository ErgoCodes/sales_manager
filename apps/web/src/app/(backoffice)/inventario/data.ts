import type { PermissionGrant } from '@monaco/contracts';
import { callApi, requestInit, type ApiResult } from '@/lib/api/admin';
import { listAll } from '@/lib/api/list-all';
import type { Location, StockItem } from '@/lib/api/types';
import { parseId } from '@/lib/admin/form-ids';
import { canAt, canReadInventory } from '@/lib/permissions';

/**
 * Locations whose inventory the user reads (D9 implication), archived ones included: an archived
 * location keeps its stock and admits exits and adjustments (D15).
 */
export async function inventoryLocations(grants: readonly PermissionGrant[]): Promise<ApiResult<Location[]>> {
  const all = await listAll((cursor) => callApi((api) => api.GET('/locations', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false }));
  return all.ok ? { ok: true, data: all.data.filter((l) => canReadInventory(grants, l.id)) } : all;
}

/**
 * Locations where the user may transfer (`inventory:transfer`). D7 asks for it at the origin and at the
 * destination, so a transfer is possible only when this has at least two locations.
 */
export function transferLocations(visible: readonly Location[], grants: readonly PermissionGrant[]): Location[] {
  return visible.filter((l) => canAt(grants, 'inventory:transfer', l.id));
}

/** The asked location when visible; otherwise the first active one, else the first. */
export function pickLocation(visible: readonly Location[], asked: string | undefined): Location | undefined {
  const id = parseId(asked ?? '');
  return visible.find((l) => l.id === id) ?? visible.find((l) => !l.archivedAt) ?? visible[0];
}

/** Every stock row of a location (products by name), for selectors and name lookups. */
export function allStock(locationId: string): Promise<ApiResult<StockItem[]>> {
  return listAll((cursor) => callApi((api) => api.GET('/locations/{locationId}/stock', { params: { path: { locationId }, query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false }));
}

export interface ProductInfo {
  name: string;
  unitOfMeasure: string;
}

/** Product names and units of the given locations' stock. A failed read only loses the names. */
export async function productInfo(locationIds: readonly string[]): Promise<Map<string, ProductInfo>> {
  const info = new Map<string, ProductInfo>();
  const results = await Promise.all([...new Set(locationIds)].map((id) => allStock(id)));
  for (const result of results) if (result.ok) for (const item of result.data) info.set(item.productId, { name: item.name, unitOfMeasure: item.unitOfMeasure });
  return info;
}

export const productLabel = (info: ReadonlyMap<string, ProductInfo>, productId: string) => info.get(productId)?.name ?? `${productId.slice(0, 8)}…`;
