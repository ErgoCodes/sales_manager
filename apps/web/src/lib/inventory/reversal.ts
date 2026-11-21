import type { InventoryDocument, PermissionGrant } from '@monaco/contracts';
import { canAt } from '@/lib/permissions';

/**
 * UI hint for the "Revertir" action: the original document's permission in every location it touched
 * (entries, exits and adjustments: `inventory:write`; transfers: `inventory:transfer` at both ends, D7).
 * A reversal is never reversed (D8), and a location hidden by the API (null) means the user lacks it.
 * The API stays the authority, including `ALREADY_REVERSED` for a document reversed before.
 */
export function canReverseDocument(grants: readonly PermissionGrant[], doc: Pick<InventoryDocument, 'kind' | 'locationId' | 'targetLocationId'>): boolean {
  if (doc.kind === 'reversal') return false;
  if (doc.kind === 'transfer') {
    const { locationId: from, targetLocationId: to } = doc;
    return from !== null && to !== null && canAt(grants, 'inventory:transfer', from) && canAt(grants, 'inventory:transfer', to);
  }
  return doc.locationId !== null && canAt(grants, 'inventory:write', doc.locationId);
}
