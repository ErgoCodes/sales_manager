import type { InventoryDocument, InventoryMovement } from '@monaco/contracts';

import { iso } from '../../iam/application/admin-support';
import type { EffectivePermissions } from '../../iam/domain/types';
import { canRead } from '../../iam/domain/permissions';
import { canSeeCosts } from '../../catalog/domain/cost-visibility';
import type { StoredDocument, StoredMovement } from '../domain/inventory-ports';

/** What one actor may see of the ledger, per location. */
export interface LedgerView {
  /** `inventory:view` there, with the D9 implication (`inventory:write`/`inventory:transfer`). */
  canView(locationId: string): boolean;
  /** D10: `catalog:write` or `inventory:write` there. */
  canSeeCosts(locationId: string): boolean;
}

export function ledgerView(effective: EffectivePermissions): LedgerView {
  return {
    canView: (locationId) => canRead(effective, 'inventory:view', locationId),
    canSeeCosts: (locationId) => canSeeCosts(effective, locationId),
  };
}

export interface Counterpart {
  readonly id: string | null;
  readonly name: string | null;
}

/**
 * A movement for `view`: its unit cost only with cost visibility in its location,
 * and the other location of a transfer only with `inventory:view` there ("otro punto").
 */
export function toMovement(movement: StoredMovement, counterpart: Counterpart, view: LedgerView): InventoryMovement {
  const visible = counterpart.id !== null && view.canView(counterpart.id);
  return {
    id: movement.id,
    documentId: movement.documentId,
    locationId: movement.locationId,
    counterpartLocationId: visible ? counterpart.id : null,
    counterpartLocationName: visible ? counterpart.name : null,
    productId: movement.productId,
    kind: movement.kind,
    quantityDelta: movement.quantityDelta,
    unitCost: view.canSeeCosts(movement.locationId) ? { amount: movement.unitCost, currency: movement.currency } : null,
    reversesMovementId: movement.reversesMovementId,
    createdAt: iso(movement.createdAt),
  };
}

const NO_COUNTERPART: Counterpart = { id: null, name: null };

/** The other location of a transfer, seen from the movement's location. */
function counterpartOf(stored: StoredDocument, movement: StoredMovement): Counterpart {
  if (stored.kind !== 'transfer' || stored.targetLocationId === null) return NO_COUNTERPART;
  return movement.locationId === stored.locationId
    ? { id: stored.targetLocationId, name: stored.targetLocationName }
    : { id: stored.locationId, name: stored.locationName };
}

/** Every location a document touches: its header locations and those of its movements (a reversal spans the original's). */
export function documentLocations(stored: StoredDocument): string[] {
  const ids = [stored.locationId, ...(stored.targetLocationId ? [stored.targetLocationId] : []), ...stored.movements.map((m) => m.locationId)];
  return [...new Set(ids)];
}

/**
 * Stored document -> `InventoryDocument` for `view`: header locations the actor
 * cannot view are masked (id and name null), only movements in viewable
 * locations are listed, and costs follow D10 per movement location.
 */
export function toDocument(stored: StoredDocument, view: LedgerView): InventoryDocument {
  const showLocation = view.canView(stored.locationId);
  const showTarget = stored.targetLocationId !== null && view.canView(stored.targetLocationId);
  return {
    id: stored.id,
    kind: stored.kind,
    locationId: showLocation ? stored.locationId : null,
    locationName: showLocation ? stored.locationName : null,
    targetLocationId: showTarget ? stored.targetLocationId : null,
    targetLocationName: showTarget ? stored.targetLocationName : null,
    reason: stored.reason,
    reversesDocumentId: stored.reversesDocumentId,
    occurredAt: iso(stored.occurredAt),
    notes: stored.notes,
    createdBy: stored.createdBy,
    createdAt: iso(stored.createdAt),
    movements: stored.movements.filter((m) => view.canView(m.locationId)).map((m) => toMovement(m, counterpartOf(stored, m), view)),
  };
}
