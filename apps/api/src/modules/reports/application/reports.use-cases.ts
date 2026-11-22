import {
  type CurrencyCode,
  CURRENCIES,
  type DailySeries,
  type InventoryHealth,
  MAX_HEALTH_ITEMS,
  type ReportRangeQuery,
  type ReportScope,
  type ReportSummary,
  type SummaryByLocation,
  type TopProducts,
  type TopProductsQuery,
} from '@monaco/contracts';
import { costValue, DEFAULT_LOW_STOCK_THRESHOLD, getProductThreshold, isLowStock, isNearExpiration, isStagnant } from '@monaco/domain';

import type { AuthenticatedActor } from '../../iam/domain/actor';
import { ResourceNotFound } from '../../iam/domain/errors';
import { assertReportsSomewhere, reportableLocations, reportScopeAt } from '../domain/report-access';
import type { DayRange, LocationRecord, PairHealthRecord, ReportClock, ReportsReader, ReportsUnitOfWork, SalesFilter } from '../domain/reports-ports';
import { summarize } from './report-totals';

/*
 * Report use cases (SP4 spec, "API de reportes"). Each one is the authority
 * (ADR 0005): it checks permission + location before reading anything, reads
 * only the authorized locations, and applies the per-row rules of
 * `@monaco/domain` on the aggregated rows. The day and the cut-off come from
 * the database clock in the tenant zone (D3): "today" never depends on the
 * device or the API host.
 */

interface Resolved {
  readonly scope: ReportScope;
  readonly locations: LocationRecord[];
  readonly clock: ReportClock;
}

/**
 * The locations a report covers: the one asked for (404 if the tenant has no such
 * location, after the permission check) or every active location where the actor
 * has `reports:view`.
 */
async function resolve(actor: AuthenticatedActor, reader: ReportsReader, locationId: string | undefined, scope: ReportScope): Promise<Resolved> {
  const clock = await reader.clock();
  if (locationId !== undefined) {
    const location = await reader.findLocation(locationId);
    if (!location) throw new ResourceNotFound('location');
    return { scope, locations: [location], clock };
  }
  return { scope, locations: reportableLocations(actor.effective, await reader.activeLocations()), clock };
}

/** Permission check before the unit of work opens. */
function preauthorize(actor: AuthenticatedActor, locationId: string | undefined, allowOwn: boolean): ReportScope {
  if (locationId !== undefined) return reportScopeAt(actor.effective, locationId, allowOwn);
  assertReportsSomewhere(actor.effective);
  return 'location';
}

/** Both ends or neither (the contract enforces it): without them, today in the tenant zone. */
const rangeOf = (query: ReportRangeQuery, clock: ReportClock): DayRange =>
  query.from !== undefined && query.to !== undefined ? { from: query.from, to: query.to } : { from: clock.today, to: clock.today };

function filterOf(resolved: Resolved, range: DayRange, actor: AuthenticatedActor): SalesFilter {
  return {
    locationIds: resolved.locations.map((location) => location.id),
    range,
    timeZone: resolved.clock.timeZone,
    ...(resolved.scope === 'own' ? { cashierUserId: actor.userId } : {}),
  };
}

/**
 * A local day as the domain's date rules expect it: midnight of that day in the
 * host's zone, which is what `parseISO('YYYY-MM-DD')` gives them for their own
 * argument too, so calendar-day differences stay exact whatever the host zone.
 */
function asDomainDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

const echo = (range: DayRange, clock: ReportClock) => ({ ...range, timeZone: clock.timeZone, asOf: clock.asOf.toISOString() });

/**
 * GET /reports/summary: `reports:view` on the location (or on all my locations),
 * or `reports:view_own` on the location: only the actor's sales, no costs.
 */
export class GetReportSummary {
  constructor(private readonly uow: ReportsUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: ReportRangeQuery): Promise<ReportSummary> {
    const scope = preauthorize(actor, query.locationId, true);
    return this.uow.run(actor.tenantId, async (reader) => {
      const resolved = await resolve(actor, reader, query.locationId, scope);
      const range = rangeOf(query, resolved.clock);
      const filter = filterOf(resolved, range, actor);
      const withCosts = scope === 'location';
      const sales = await reader.salesTotals(filter, false);
      const valued = withCosts ? await reader.valuedMovements(filter) : [];
      return {
        scope,
        locationIds: filter.locationIds.slice(),
        ...echo(range, resolved.clock),
        currencies: summarize(sales, valued, withCosts),
      };
    });
  }
}

/** GET /reports/daily-series: `reports:view`; one point per local day and currency. */
export class GetDailySeries {
  constructor(private readonly uow: ReportsUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: ReportRangeQuery): Promise<DailySeries> {
    const scope = preauthorize(actor, query.locationId, false);
    return this.uow.run(actor.tenantId, async (reader) => {
      const resolved = await resolve(actor, reader, query.locationId, scope);
      const range = rangeOf(query, resolved.clock);
      const filter = filterOf(resolved, range, actor);
      const points = await reader.dailySales(filter);
      const currencies = CURRENCIES.filter((currency) => points.some((point) => point.currency === currency));
      return {
        locationIds: filter.locationIds.slice(),
        ...echo(range, resolved.clock),
        series: currencies.map((currency) => ({
          currency,
          points: points
            .filter((point) => point.currency === currency)
            .map((point) => ({ date: point.date, totalSales: point.totalSales, profit: point.profit })),
        })),
      };
    });
  }
}

/** GET /reports/top-products: `reports:view`; by revenue, quantity or profit. */
export class GetTopProducts {
  constructor(private readonly uow: ReportsUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: TopProductsQuery): Promise<TopProducts> {
    const scope = preauthorize(actor, query.locationId, false);
    return this.uow.run(actor.tenantId, async (reader) => {
      const resolved = await resolve(actor, reader, query.locationId, scope);
      const range = rangeOf(query, resolved.clock);
      const filter = filterOf(resolved, range, actor);
      const items = await reader.topProducts(filter, query.by, query.limit);
      return { locationIds: filter.locationIds.slice(), ...echo(range, resolved.clock), by: query.by, items };
    });
  }
}

/** GET /reports/by-location: `reports:view`; a compact summary per visible location. */
export class GetSummaryByLocation {
  constructor(private readonly uow: ReportsUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: ReportRangeQuery): Promise<SummaryByLocation> {
    const scope = preauthorize(actor, query.locationId, false);
    return this.uow.run(actor.tenantId, async (reader) => {
      const resolved = await resolve(actor, reader, query.locationId, scope);
      const range = rangeOf(query, resolved.clock);
      const filter = filterOf(resolved, range, actor);
      const sales = await reader.salesTotals(filter, true);
      const valued = await reader.valuedMovements(filter);
      return {
        ...echo(range, resolved.clock),
        locations: resolved.locations.map((location) => ({
          locationId: location.id,
          locationName: location.name,
          currencies: summarize(
            sales.filter((row) => row.locationId === location.id),
            valued.filter((row) => row.locationId === location.id),
            true,
          ),
        })),
      };
    });
  }
}

const byName = (a: PairHealthRecord, b: PairHealthRecord) =>
  a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId) || a.locationId.localeCompare(b.locationId);

function listOf<T>(records: readonly PairHealthRecord[], extra: (record: PairHealthRecord) => T) {
  return {
    count: records.length,
    items: records.slice(0, MAX_HEALTH_ITEMS).map((record) => ({
      productId: record.productId,
      locationId: record.locationId,
      name: record.name,
      unitOfMeasure: record.unitOfMeasure,
      quantity: record.quantity,
      ...extra(record),
    })),
  };
}

/** Σ stock × average cost per currency over the pairs holding stock (`costValue`). */
function inventoryValue(pairs: readonly PairHealthRecord[]) {
  const currencies = CURRENCIES.filter((currency) => pairs.some((pair) => pair.currency === currency && pair.quantity > 0));
  return currencies.map((currency: CurrencyCode) => ({
    currency,
    amount: costValue(
      pairs
        .filter((pair) => pair.currency === currency && pair.quantity > 0)
        .map((pair) => ({ quantityDelta: pair.quantity, unitCost: pair.averageCost })),
    ),
  }));
}

/**
 * GET /reports/inventory-health: `reports:view`; at the moment, never by range.
 * Only the authorized locations' pairs are read, so no stock of another location
 * leaks. Active products only in the lists (an archived product is out of the
 * catalog); its remaining stock still counts in the value. Near expiration lists
 * only pairs that still hold stock: a product with none there cannot expire there.
 */
export class GetInventoryHealth {
  constructor(private readonly uow: ReportsUnitOfWork) {}

  async execute(actor: AuthenticatedActor, query: { locationId?: string }): Promise<InventoryHealth> {
    const scope = preauthorize(actor, query.locationId, false);
    return this.uow.run(actor.tenantId, async (reader) => {
      const resolved = await resolve(actor, reader, query.locationId, scope);
      const locationIds = resolved.locations.map((location) => location.id);
      const pairs = await reader.pairHealth(locationIds, resolved.clock.timeZone);
      const today = asDomainDay(resolved.clock.today);
      const active = pairs.filter((pair) => !pair.archived).sort(byName);
      const thresholdOf = (pair: PairHealthRecord) => getProductThreshold(pair, DEFAULT_LOW_STOCK_THRESHOLD);
      const low = active.filter((pair) => isLowStock(pair.quantity, pair, DEFAULT_LOW_STOCK_THRESHOLD));
      const stagnant = active
        .filter((pair) => isStagnant({ stock: pair.quantity, lastSaleDate: pair.lastSaleDate, today }))
        .sort((a, b) => (a.lastSaleDate ?? '').localeCompare(b.lastSaleDate ?? ''));
      const near = active
        .filter((pair) => pair.quantity > 0 && isNearExpiration({ expirationDate: pair.expirationDate, today }))
        .sort((a, b) => (a.expirationDate ?? '').localeCompare(b.expirationDate ?? ''));
      return {
        locationIds,
        timeZone: resolved.clock.timeZone,
        asOf: resolved.clock.asOf.toISOString(),
        lowStock: listOf(low, (pair) => ({ threshold: thresholdOf(pair) })),
        stagnant: listOf(stagnant, (pair) => ({ lastSaleDate: pair.lastSaleDate })),
        // isNearExpiration is false without a date, so every listed pair has one.
        nearExpiration: listOf(near, (pair) => ({ expirationDate: pair.expirationDate! })),
        inventoryValue: inventoryValue(pairs),
      };
    });
  }
}
