import { can } from '../../iam/domain/permissions';
import type { EffectivePermissions } from '../../iam/domain/types';

/**
 * Cost visibility (SP3 D10): `cost_price`, `average_cost` and `unit_cost` go only
 * to someone holding `catalog:write` or `inventory:write` in that scope: at the
 * location, or tenant-wide when there is no location. Shared by the catalog and
 * the inventory reads, so both answer the same question the same way.
 */
export function canSeeCosts(effective: EffectivePermissions, locationId?: string): boolean {
  return can(effective, 'catalog:write', locationId) || can(effective, 'inventory:write', locationId);
}
