import { saleLineAmounts } from '@monaco/domain';
import { Pool, type PoolClient } from 'pg';

import { uuidv7 } from '../../src/infrastructure/db/uuidv7';
import { urls } from './helpers';

/*
 * Test fixture builder for the reports (SP4 · T6): sales and ledger documents
 * written by SQL as monaco_owner inside the tenant (FORCE RLS binds the owner
 * too), so the reports are tested without RecordSale (T5). It satisfies the T4
 * composite FKs: the `sale` document, the `sales` header and every line share
 * the id, location, instant and cashier. Amounts come from saleLineAmounts,
 * like RecordSale. Instants are `timestamptz` text, so a test can say
 * '2026-03-07 23:59:59 America/Havana' and Postgres resolves the zone.
 */

export type Currency = 'CUP' | 'USD' | 'MLC';

export interface LineSpec {
  product: string;
  currency?: Currency;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  paymentMethod?: 'cash' | 'transfer';
  isCostSale?: boolean;
}

export interface SaleSpec {
  location: string;
  cashier: string;
  /** timestamptz text (ISO or with a zone name). */
  at: string;
  lines: LineSpec[];
}

export interface DocumentSpec {
  location: string;
  product: string;
  quantity: number;
  unitCost: number;
  at: string;
  createdBy: string;
}

export class SalesFixtures {
  readonly pool = new Pool({ connectionString: urls().owner, max: 2 });

  async end(): Promise<void> {
    await this.pool.end();
  }

  /** Runs `work` in one transaction scoped to the tenant, as the RLS policy requires. */
  async inTenant<T>(tenant: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async pair(tenant: string, location: string, product: string, averageCost = 0): Promise<void> {
    await this.inTenant(tenant, (c) =>
      c.query(
        `insert into location_products (tenant_id, location_id, product_id, average_cost) values ($1, $2, $3, $4)
         on conflict (tenant_id, location_id, product_id) do update set average_cost = excluded.average_cost`,
        [tenant, location, product, averageCost],
      ),
    );
  }

  private async document(c: PoolClient, tenant: string, kind: string, spec: { location: string; at: string; createdBy: string }, extra: { reason?: string; reverses?: string } = {}) {
    const id = uuidv7();
    await c.query(
      `insert into inventory_documents (id, tenant_id, kind, location_id, reason, reverses_document_id, occurred_at, payload_hash, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::timestamptz, 'fixture', $8)`,
      [id, tenant, kind, spec.location, extra.reason ?? null, extra.reverses ?? null, spec.at, spec.createdBy],
    );
    return id;
  }

  private async movement(c: PoolClient, tenant: string, document: string, location: string, product: string, kind: string, delta: number, unitCost: number, reverses?: string) {
    const id = uuidv7();
    await c.query(
      `insert into inventory_movements (id, tenant_id, document_id, location_id, product_id, kind, quantity_delta, unit_cost, reverses_movement_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, tenant, document, location, product, kind, delta, unitCost, reverses ?? null],
    );
    return id;
  }

  /** An `entry` document with one line. */
  async entry(tenant: string, spec: DocumentSpec): Promise<string> {
    await this.ensurePair(tenant, spec.location, spec.product);
    return this.inTenant(tenant, async (c) => {
      const id = await this.document(c, tenant, 'entry', spec);
      await this.movement(c, tenant, id, spec.location, spec.product, 'entry', spec.quantity, spec.unitCost);
      return id;
    });
  }

  /** An `exit` document (shrinkage or owner withdrawal) with one line. */
  async exit(tenant: string, spec: DocumentSpec & { reason: 'shrinkage' | 'owner_withdrawal' }): Promise<string> {
    await this.ensurePair(tenant, spec.location, spec.product);
    return this.inTenant(tenant, async (c) => {
      const id = await this.document(c, tenant, 'exit', spec, { reason: spec.reason });
      await this.movement(c, tenant, id, spec.location, spec.product, spec.reason, -spec.quantity, spec.unitCost);
      return id;
    });
  }

  /** Reverses a document as ADR 0006 does: a `reversal` document whose movements negate the original ones. */
  async reverse(tenant: string, original: string, at: string, createdBy: string): Promise<string> {
    return this.inTenant(tenant, async (c) => {
      const { rows } = await c.query<{ id: string; location_id: string; product_id: string; quantity_delta: string; unit_cost: string; doc_location: string }>(
        `select m.id, m.location_id, m.product_id, m.quantity_delta, m.unit_cost, d.location_id as doc_location
         from inventory_movements m join inventory_documents d on d.id = m.document_id where m.document_id = $1`,
        [original],
      );
      const id = await this.document(c, tenant, 'reversal', { location: rows[0]!.doc_location, at, createdBy }, { reverses: original });
      for (const m of rows) {
        await this.movement(c, tenant, id, m.location_id, m.product_id, 'reversal', -Number(m.quantity_delta), Number(m.unit_cost), m.id);
      }
      return id;
    });
  }

  /** A sale: its `sale` document, one `sale` movement per line, the header and the lines (amounts by saleLineAmounts). */
  async sale(tenant: string, spec: SaleSpec): Promise<string> {
    for (const line of spec.lines) await this.ensurePair(tenant, spec.location, line.product);
    return this.inTenant(tenant, async (c) => {
      const id = await this.document(c, tenant, 'sale', { location: spec.location, at: spec.at, createdBy: spec.cashier });
      await c.query(
        `insert into sales (id, tenant_id, location_id, cashier_user_id, occurred_at, payload_hash) values ($1, $2, $3, $4, $5::timestamptz, 'fixture')`,
        [id, tenant, spec.location, spec.cashier, spec.at],
      );
      for (const line of spec.lines) {
        const isCostSale = line.isCostSale ?? false;
        const amounts = saleLineAmounts({ quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, isCostSale });
        await this.movement(c, tenant, id, spec.location, line.product, 'sale', -line.quantity, line.unitCost);
        await c.query(
          `insert into sale_lines (id, tenant_id, sale_id, location_id, product_id, occurred_at, cashier_user_id, currency, quantity,
                                   unit_price, discount_percent, payment_method, is_cost_sale, unit_cost, line_total, profit)
           values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15)`,
          [
            uuidv7(),
            tenant,
            id,
            spec.location,
            line.product,
            spec.at,
            spec.cashier,
            line.currency ?? 'CUP',
            line.quantity,
            line.unitPrice,
            line.paymentMethod ?? 'cash',
            isCostSale,
            line.unitCost,
            amounts.lineTotal,
            amounts.profit,
          ],
        );
      }
      return id;
    });
  }

  private ensurePair(tenant: string, location: string, product: string): Promise<unknown> {
    return this.inTenant(tenant, (c) =>
      c.query(`insert into location_products (tenant_id, location_id, product_id) values ($1, $2, $3) on conflict do nothing`, [tenant, location, product]),
    );
  }
}
