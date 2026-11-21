import type { InventoryDocument } from '@monaco/contracts';

import { iso } from '../../iam/application/admin-support';
import type { StoredDocument } from '../domain/inventory-ports';

/**
 * Stored document -> `InventoryDocument`. Costs are included: every caller here
 * holds `inventory:write` in the document's location (D10), the only way to write one.
 */
export function toDocument(stored: StoredDocument): InventoryDocument {
  return {
    id: stored.id,
    kind: stored.kind,
    locationId: stored.locationId,
    targetLocationId: stored.targetLocationId,
    reason: stored.reason,
    reversesDocumentId: stored.reversesDocumentId,
    occurredAt: iso(stored.occurredAt),
    notes: stored.notes,
    createdBy: stored.createdBy,
    createdAt: iso(stored.createdAt),
    movements: stored.movements.map((m) => ({
      id: m.id,
      documentId: m.documentId,
      locationId: m.locationId,
      productId: m.productId,
      kind: m.kind,
      quantityDelta: m.quantityDelta,
      unitCost: { amount: m.unitCost, currency: m.currency },
      reversesMovementId: m.reversesMovementId,
      createdAt: iso(m.createdAt),
    })),
  };
}
