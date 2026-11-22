import type { CurrencyCode as Currency, TopProductsOrder } from '@monaco/contracts';

/*
 * Ports of the reports module (SP4 spec, "API de reportes"; ADR 0007). Reads
 * only: aggregates over `sale_lines` and the inventory ledger, inside one
 * `withTenant` transaction so RLS stays the second barrier. Amounts arrive
 * already summed per currency; the per-row rules (margin, average ticket, loss
 * and cost values, thresholds, stagnant, near expiration) stay in the use cases,
 * through `@monaco/domain`.
 */

/** The tenant's reporting clock, read from the database (never the device or the API host). */
export interface ReportClock {
  /** IANA zone stored for the tenant (validated when written, never re-validated: ADR 0007 §4). */
  readonly timeZone: string;
  /** Database now(): every report is cut there. */
  readonly asOf: Date;
  /** Today in the tenant zone, `YYYY-MM-DD`. */
  readonly today: string;
}

/** Local days, both inclusive, `YYYY-MM-DD`. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** What every ranged read filters on. Location ids are already authorized by the use case. */
export interface SalesFilter {
  readonly locationIds: readonly string[];
  readonly range: DayRange;
  readonly timeZone: string;
  /** `reports:view_own`: only the lines of this cashier (the actor, never a parameter). */
  readonly cashierUserId?: string;
}

export interface LocationRecord {
  readonly id: string;
  readonly name: string;
}

/** Sums of sale lines of one currency, per location when asked. */
export interface SalesTotalsRecord {
  /** Null when the totals are not split by location. */
  readonly locationId: string | null;
  readonly currency: Currency;
  readonly cashSales: number;
  readonly transferSales: number;
  /** Σ frozen profit: minor units, up to 6 decimals. */
  readonly profit: number;
  /** Distinct sales with at least one line in this currency. */
  readonly tickets: number;
}

/** The ledger kinds the summary values: losses (shrinkage, owner withdrawals) and entries. */
export type ValuedMovementKind = 'shrinkage' | 'owner_withdrawal' | 'entry';

/** Ledger quantities of one (location, kind, currency, unit cost): `Σ |quantity_delta|`. */
export interface ValuedQuantityRecord {
  readonly locationId: string;
  readonly kind: ValuedMovementKind;
  readonly currency: Currency;
  readonly unitCost: number;
  readonly quantity: number;
}

/** One local day of one currency (days without sales are 0). */
export interface DailyPointRecord {
  readonly currency: Currency;
  readonly date: string;
  readonly totalSales: number;
  readonly profit: number;
}

export interface TopProductRecord {
  readonly productId: string;
  readonly name: string;
  readonly unitOfMeasure: string;
  readonly currency: Currency;
  readonly quantity: number;
  readonly totalSales: number;
  readonly profit: number;
}

/** A (location, product) pair as the inventory health needs it, at the moment. */
export interface PairHealthRecord {
  readonly locationId: string;
  readonly productId: string;
  readonly name: string;
  readonly unitOfMeasure: string;
  readonly category: string | null;
  readonly currency: Currency;
  readonly lowStockThreshold: number | null;
  readonly expirationDate: string | null;
  readonly archived: boolean;
  /** SUM(quantity_delta) of the pair. */
  readonly quantity: number;
  readonly averageCost: number;
  /** Local day of the last non-reversed sale up to now(); null if never sold. */
  readonly lastSaleDate: string | null;
}

export interface ReportsReader {
  clock(): Promise<ReportClock>;
  /** Any location of the tenant, archived included (its history still reports). */
  findLocation(id: string): Promise<LocationRecord | null>;
  /** Active locations of the tenant, by name. */
  activeLocations(): Promise<LocationRecord[]>;
  salesTotals(filter: SalesFilter, perLocation: boolean): Promise<SalesTotalsRecord[]>;
  /** Shrinkage, owner withdrawals and entries of non-reversed documents in the range. */
  valuedMovements(filter: SalesFilter): Promise<ValuedQuantityRecord[]>;
  dailySales(filter: SalesFilter): Promise<DailyPointRecord[]>;
  topProducts(filter: SalesFilter, by: TopProductsOrder, limit: number): Promise<TopProductRecord[]>;
  pairHealth(locationIds: readonly string[], timeZone: string): Promise<PairHealthRecord[]>;
}

/** Runs report reads on one tenant-scoped transaction (`withTenant`). */
export interface ReportsUnitOfWork {
  run<T>(tenantId: string, work: (reader: ReportsReader) => Promise<T>): Promise<T>;
}
