import type { Money } from '@monaco/contracts';
import type { PaymentMethod } from '@monaco/domain';

import type { InventoryScope } from '../../inventory/domain/inventory-ports';

type Currency = Money['currency'];

/** The `sales` row: the same id, location and instant as its `sale` document. */
export interface NewSaleHeader {
  readonly id: string;
  readonly locationId: string;
  readonly cashierUserId: string;
  readonly occurredAt: Date;
  readonly payloadHash: string;
}

/** A `sale_lines` row; `locationId`, `occurredAt` and `cashierUserId` are copied from the header. */
export interface NewSaleLine {
  readonly productId: string;
  readonly currency: Currency;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly discountPercent: number;
  readonly paymentMethod: PaymentMethod;
  readonly isCostSale: boolean;
  readonly unitCost: number;
  readonly lineTotal: number;
  readonly profit: number;
}

export interface StoredSaleLine extends NewSaleLine {
  readonly id: string;
}

export interface StoredSale extends NewSaleHeader {
  readonly deviceId: string | null;
  readonly createdAt: Date;
  /** By product id: a product appears once per sale. */
  readonly lines: readonly StoredSaleLine[];
}

/** `sales` and `sale_lines` of the current tenant (RLS); append-only for monaco_app. */
export interface SalesRepository {
  /** Inserts the header and its lines, copying the header columns into every line (T4's composite FKs). */
  insert(header: NewSaleHeader, lines: readonly NewSaleLine[]): Promise<void>;
  /** The sale with its lines, or null when missing or of another tenant. */
  find(id: string): Promise<StoredSale | null>;
}

/** The inventory scope (the ADR 0006 script writes the `sale` document) plus the sales tables, on one transaction. */
export interface SalesScope extends InventoryScope {
  readonly sales: SalesRepository;
}

/** Same contract as `TenantUnitOfWork`: one `withTenant` transaction per `run`. */
export interface SalesUnitOfWork {
  run<T>(tenantId: string, work: (scope: SalesScope) => Promise<T>): Promise<T>;
}
