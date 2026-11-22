import type { PaymentMethod } from '@monaco/domain';
import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { uuidv7 } from '../../../../infrastructure/db/uuidv7';
import { rows, toDate } from '../../../iam/infrastructure/sql-helpers';
import type { NewSaleHeader, NewSaleLine, SalesRepository, StoredSale, StoredSaleLine } from '../../domain/sales-ports';

type Dated = Date | string;

interface SaleRow {
  id: string;
  locationId: string;
  cashierUserId: string;
  deviceId: string | null;
  occurredAt: Dated;
  payloadHash: string;
  createdAt: Dated;
}

interface LineRow {
  id: string;
  productId: string;
  currency: StoredSaleLine['currency'];
  quantity: string;
  unitPrice: string | number;
  discountPercent: string;
  paymentMethod: PaymentMethod;
  isCostSale: boolean;
  unitCost: string;
  lineTotal: string | number;
  profit: string;
}

/**
 * `sales` and `sale_lines` on one `withTenant` transaction. monaco_app only has INSERT and
 * SELECT on them. Every line copies `location_id`, `occurred_at` and `cashier_user_id` from
 * its header in the same statement, so `sale_lines_sale_fk` always holds.
 */
export class SalesDrizzleRepository implements SalesRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async insert(header: NewSaleHeader, lines: readonly NewSaleLine[]): Promise<void> {
    await this.tx.execute(
      sql`insert into sales (id, tenant_id, location_id, cashier_user_id, device_id, occurred_at, payload_hash)
          values (${header.id}, ${this.tenantId}, ${header.locationId}, ${header.cashierUserId}, null, ${header.occurredAt}, ${header.payloadHash})`,
    );
    const values = lines.map(
      (line) =>
        sql`(${uuidv7()}, ${this.tenantId}, ${header.id}, ${header.locationId}, ${line.productId}, ${header.occurredAt}, ${header.cashierUserId},
             ${line.currency}, ${line.quantity}, ${line.unitPrice}, ${line.discountPercent.toFixed(2)}, ${line.paymentMethod}, ${line.isCostSale},
             ${line.unitCost.toFixed(6)}, ${line.lineTotal}, ${line.profit.toFixed(6)})`,
    );
    await this.tx.execute(
      sql`insert into sale_lines
            (id, tenant_id, sale_id, location_id, product_id, occurred_at, cashier_user_id,
             currency, quantity, unit_price, discount_percent, payment_method, is_cost_sale, unit_cost, line_total, profit)
          values ${sql.join(values, sql`, `)}`,
    );
  }

  async find(id: string): Promise<StoredSale | null> {
    const [sale] = await rows<SaleRow>(
      this.tx,
      sql`select id, location_id as "locationId", cashier_user_id as "cashierUserId", device_id as "deviceId",
                 occurred_at as "occurredAt", payload_hash as "payloadHash", created_at as "createdAt"
          from sales where tenant_id = ${this.tenantId} and id = ${id}`,
    );
    if (!sale) return null;
    const lines = await rows<LineRow>(
      this.tx,
      sql`select id, product_id as "productId", currency, quantity::text as quantity, unit_price as "unitPrice",
                 discount_percent::text as "discountPercent", payment_method as "paymentMethod", is_cost_sale as "isCostSale",
                 unit_cost::text as "unitCost", line_total as "lineTotal", profit::text as profit
          from sale_lines where tenant_id = ${this.tenantId} and sale_id = ${id}
          order by product_id`,
    );
    return {
      ...sale,
      occurredAt: toDate(sale.occurredAt),
      createdAt: toDate(sale.createdAt),
      lines: lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discountPercent: Number(line.discountPercent),
        unitCost: Number(line.unitCost),
        lineTotal: Number(line.lineTotal),
        profit: Number(line.profit),
      })),
    };
  }
}
