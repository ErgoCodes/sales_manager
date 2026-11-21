import type { CurrencyCode, Paginated } from '@monaco/contracts';

import type { PageRequest } from '../../iam/domain/admin-ports';
import type { AuditLog } from '../../iam/domain/auth-ports';

/** Amounts are integers in minor units of the product's currency (`null` = not set). */
export interface ProductRecord {
  readonly id: string;
  readonly name: string;
  readonly unitOfMeasure: string;
  readonly category: string | null;
  readonly currency: CurrencyCode;
  readonly costPrice: number | null;
  readonly cashPrice: number | null;
  readonly transferPrice: number | null;
  readonly lowStockThreshold: number | null;
  /** `YYYY-MM-DD`. */
  readonly expirationDate: string | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A product with the overrides of one location (both `null` when no location was asked for or none is set). */
export interface ProductPriceRecord extends ProductRecord {
  readonly cashPriceOverride: number | null;
  readonly transferPriceOverride: number | null;
}

export type NewProduct = Pick<ProductRecord, 'name' | 'unitOfMeasure' | 'currency'> &
  Partial<Pick<ProductRecord, 'category' | 'costPrice' | 'cashPrice' | 'transferPrice' | 'lowStockThreshold' | 'expirationDate'>>;

/** `undefined` keeps the column; `null` clears a nullable one. */
export type ProductChanges = Partial<
  Pick<ProductRecord, 'name' | 'unitOfMeasure' | 'category' | 'currency' | 'costPrice' | 'cashPrice' | 'transferPrice' | 'lowStockThreshold' | 'expirationDate'>
>;

export interface ProductFilter {
  readonly q?: string;
  readonly category?: string;
  readonly includeArchived: boolean;
  /** Joins that location's price overrides. */
  readonly locationId?: string;
}

/** Products of the current tenant (RLS). Archived, never deleted. */
export interface ProductRepository {
  /** Ordered by `(name, id)`. */
  list(page: PageRequest & ProductFilter): Promise<Paginated<ProductPriceRecord>>;
  findById(id: string, locationId?: string): Promise<ProductPriceRecord | null>;
  create(input: NewProduct & { readonly now: Date }): Promise<ProductRecord>;
  /** `SELECT ... FOR UPDATE`: serializes with the inventory documents, which read the product `FOR SHARE` (ADR 0006). */
  lockForUpdate(id: string): Promise<ProductRecord | null>;
  /** `SELECT ... FOR SHARE`: a concurrent edit or archive waits for this transaction. */
  lockForShare(id: string): Promise<ProductRecord | null>;
  update(id: string, changes: ProductChanges, now: Date): Promise<ProductRecord>;
  /** Sets `archived_at` once; archiving again keeps the first date. */
  archive(id: string, now: Date): Promise<ProductRecord | null>;
  hasMovements(id: string): Promise<boolean>;
  /** True when some location still has a cash or transfer price override for the product. */
  hasPriceOverrides(id: string): Promise<boolean>;
}

/** The per-location price overrides: columns of `location_products`, the row that also holds the pair's lock. */
export interface LocationPriceRepository {
  locationExists(id: string): Promise<boolean>;
  /** Creates the pair's row if missing; `null` removes an override. */
  set(input: { readonly locationId: string; readonly productId: string; readonly cashPrice: number | null; readonly transferPrice: number | null; readonly now: Date }): Promise<void>;
}

export interface CatalogTenantScope {
  readonly products: ProductRepository;
  readonly locationPrices: LocationPriceRepository;
  readonly audit: AuditLog;
}

/** Same contract as `AdminUnitOfWork`: one `withTenant` transaction; a throw rolls everything back. */
export interface CatalogUnitOfWork {
  run<T>(tenantId: string, work: (scope: CatalogTenantScope) => Promise<T>): Promise<T>;
}
