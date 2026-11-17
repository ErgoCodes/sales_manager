import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../../../infrastructure/db/with-tenant';
import { rows } from '../../../iam/infrastructure/sql-helpers';
import type { LocationPriceRepository } from '../../domain/catalog-ports';

export class LocationPricesRepository implements LocationPriceRepository {
  constructor(
    private readonly tx: TenantTransaction,
    private readonly tenantId: string,
  ) {}

  async locationExists(id: string): Promise<boolean> {
    const found = await rows<{ one: number }>(this.tx, sql`select 1 as one from locations where id = ${id}`);
    return found.length > 0;
  }

  async set(input: { locationId: string; productId: string; cashPrice: number | null; transferPrice: number | null; now: Date }): Promise<void> {
    await this.tx.execute(
      sql`insert into location_products (tenant_id, location_id, product_id, cash_price_override, transfer_price_override, updated_at)
          values (${this.tenantId}, ${input.locationId}, ${input.productId}, ${input.cashPrice}, ${input.transferPrice}, ${input.now})
          on conflict (tenant_id, location_id, product_id) do update
            set cash_price_override = excluded.cash_price_override,
                transfer_price_override = excluded.transfer_price_override,
                updated_at = excluded.updated_at`,
    );
  }
}
