import type { Pool } from 'pg';

/**
 * Ledger invariant (spec SP3, "Notas del modelo"): nothing in the schema ties a
 * movement's location to its document's locations, so this query is the check.
 * Returns the ids of every movement outside the locations of its document:
 *  - transfer_out in `location_id`, transfer_in in `target_location_id`;
 *  - a reversal movement in a location the reversed document touched;
 *  - every other kind in `location_id`;
 *  - and every movement kind is one its document kind can hold (entry: entry; exit: shrinkage or
 *    owner_withdrawal matching the reason; adjustment: adjustment; transfer: transfer_out and
 *    transfer_in; reversal: reversal).
 * Comparisons against a NULL location (a reversed document that is not a transfer, a transfer_in
 * in a document without target) are violations, never "unknown": hence the coalesce.
 * An empty result means the invariant holds. T5a and T6 call it after every
 * kind of document they write.
 */
export async function movementsOutsideDocumentLocations(admin: Pool): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    `select m.id
     from inventory_movements m
     join inventory_documents d on d.id = m.document_id and d.tenant_id = m.tenant_id
     left join inventory_documents r on r.id = d.reverses_document_id and r.tenant_id = d.tenant_id
     where not coalesce(
       case m.kind
         when 'transfer_in' then m.location_id = d.target_location_id
         when 'transfer_out' then m.location_id = d.location_id
         when 'reversal' then m.location_id in (r.location_id, r.target_location_id) and r.id is not null
         else m.location_id = d.location_id
       end
       and case d.kind
         when 'entry' then m.kind = 'entry'
         when 'exit' then m.kind = d.reason
         when 'adjustment' then m.kind = 'adjustment'
         when 'transfer' then m.kind in ('transfer_out', 'transfer_in')
         when 'reversal' then m.kind = 'reversal'
         else false
       end,
       false)
     order by m.id`,
  );
  return rows.map((row) => row.id);
}
