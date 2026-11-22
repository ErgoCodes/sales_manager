import { saleLineAmounts } from '@monaco/domain';

import type { AdminRequest } from '../../iam/application/admin-support';
import type { Clock } from '../../iam/domain/auth-ports';
import { authorize } from '../../iam/domain/permissions';
import { businessDate } from '../../inventory/application/inventory.use-cases';
import { payloadHash } from '../../inventory/application/payload-hash';
import { type DocumentPlan, writeDocument } from '../../inventory/application/record-document';
import { InvalidSaleCommand, RecordSaleCommand } from '../domain/sale-command';
import type { NewSaleLine, SalesUnitOfWork, StoredSale } from '../domain/sales-ports';

export interface RecordedSale {
  readonly sale: StoredSale;
  /** False when the id already existed with the same content (idempotent retry). */
  readonly created: boolean;
}

/**
 * Records a sale (SP4 spec, "Ventas en el servidor"; ADR 0007). No HTTP route calls it in
 * SP4: the demo seed does, with the demo Owner's actor; SP5 exposes it without changing it.
 *
 *   1. validate the command        2. `sales:create` in the location, before any data
 *   3..7. the ADR 0006 script (`writeDocument`): idempotent header by id + `payload_hash`,
 *         FOR SHARE parents, FOR UPDATE pairs in the global order, stock sum,
 *         `assertStockNotNegative`, `unit_cost = effectiveUnitCost` under the lock,
 *         `sale` movements; then, in the same transaction, `sales` and `sale_lines` with
 *         the amounts of `saleLineAmounts`, and the `sale_recorded` audit event (no amounts).
 *
 * The cashier is the actor. Like exits (D15), a sale can drain an archived location or product.
 */
export class RecordSale {
  constructor(
    private readonly uow: SalesUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(request: AdminRequest, input: RecordSaleCommand): Promise<RecordedSale> {
    const parsed = RecordSaleCommand.safeParse(input);
    if (!parsed.success) throw new InvalidSaleCommand(parsed.error.issues);
    const command = parsed.data;
    const { actor } = request;
    authorize(actor, 'sales:create', command.locationId);
    const occurredAt = businessDate(this.clock, command.occurredAt);
    // Before the `occurredAt` default, like every ledger document: a retry without it still matches.
    const hash = payloadHash('sale', command);
    const plan: DocumentPlan = {
      id: command.id,
      kind: 'sale',
      auditType: 'sale_recorded',
      locationId: command.locationId,
      targetLocationId: null,
      reason: null,
      reversesDocumentId: null,
      occurredAt,
      notes: null,
      payloadHash: hash,
      auditMetadata: { locationId: command.locationId, lineCount: command.lines.length },
      lines: command.lines.map((line) => ({
        locationId: command.locationId,
        productId: line.productId,
        kind: 'sale',
        quantity: line.quantity,
        valuation: { type: 'sold', price: line.unitPrice },
        requiresActive: false,
      })),
    };

    return this.uow.run(actor.tenantId, async (scope) => {
      const recorded = await writeDocument(scope, request, plan, async (written) => {
        const lines = written.map(({ unitCost, currency }, index): NewSaleLine => {
          const line = command.lines[index]!;
          const amounts = saleLineAmounts({ quantity: line.quantity, unitPrice: line.unitPrice.amount, unitCost, isCostSale: line.isCostSale });
          return {
            productId: line.productId,
            currency,
            quantity: line.quantity,
            unitPrice: line.unitPrice.amount,
            discountPercent: line.discountPercent,
            paymentMethod: line.paymentMethod,
            isCostSale: line.isCostSale,
            unitCost,
            ...amounts,
          };
        });
        await scope.sales.insert({ id: command.id, locationId: command.locationId, cashierUserId: actor.userId, occurredAt, payloadHash: hash }, lines);
      });
      const sale = await scope.sales.find(command.id);
      /* v8 ignore next -- a `sale` document always has its sales row (same transaction; salesOutsideTheirDocuments) */
      if (!sale) throw new Error('Sale document without its sales row');
      return { sale, created: recorded.created };
    });
  }
}
