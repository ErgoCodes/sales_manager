import { z } from 'zod';

import { CURRENCIES, IsoDateTime, Uuid } from '../common';

/** Longest report range, both ends inclusive (a whole leap year). A longer one is `400 VALIDATION_FAILED`. */
export const MAX_REPORT_RANGE_DAYS = 366;
/** Most items each `InventoryHealth` list returns (its `count` is the full total). */
export const MAX_HEALTH_ITEMS = 10;

const DAY_MS = 86_400_000;

/** A local calendar day `YYYY-MM-DD` in the tenant's time zone (never an instant). */
export const LocalDate = z.iso
  .date()
  .meta({ id: 'LocalDate', description: 'Calendar day YYYY-MM-DD in the tenant time zone', example: '2026-11-21' });
export type LocalDate = z.infer<typeof LocalDate>;

/** `Intl.supportedValuesOf('timeZone')` lists canonical zones only and omits UTC, so it is added explicitly. */
const UTC_ZONES = ['UTC', 'Etc/UTC'];
let zones: ReadonlySet<string> | undefined;
function isSupportedTimeZone(value: string): boolean {
  zones ??= new Set([...Intl.supportedValuesOf('timeZone'), ...UTC_ZONES]);
  return zones.has(value);
}

/** IANA time zone, validated against `Intl.supportedValuesOf('timeZone')` plus `UTC` and `Etc/UTC` (SP4 · D3). */
export const TimeZone = z
  .string()
  .refine(isSupportedTimeZone, 'Unknown IANA time zone')
  .meta({ id: 'TimeZone', description: 'IANA time zone of the tenant', example: 'America/Havana' });
export type TimeZone = z.infer<typeof TimeZone>;

/** Days from `from` to `to`, both inclusive. Both are valid `LocalDate`s here. */
function inclusiveDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
}

const rangeShape = {
  from: LocalDate.optional().meta({ description: 'First local day (inclusive). Without from/to: today in the tenant time zone' }),
  to: LocalDate.optional().meta({ description: 'Last local day (inclusive)' }),
  locationId: Uuid.optional().meta({ description: 'One location; without it, every location the actor may report on' }),
};

const RANGE_RULES =
  `Send both from and to (local days, inclusive) or neither (today in the tenant time zone); from ≤ to; at most ${MAX_REPORT_RANGE_DAYS} days. ` +
  'Otherwise 400 VALIDATION_FAILED.';

/** Both ends or neither (today); `from ≤ to`; at most `MAX_REPORT_RANGE_DAYS` days. */
function checkRange(value: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  const { from, to } = value;
  if (from === undefined && to === undefined) return;
  if (from === undefined || to === undefined) {
    ctx.addIssue({ code: 'custom', path: [from === undefined ? 'from' : 'to'], message: 'Send both from and to, or neither' });
    return;
  }
  const days = inclusiveDays(from, to);
  if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
  else if (days > MAX_REPORT_RANGE_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `The range may span at most ${MAX_REPORT_RANGE_DAYS} days` });
  }
}

/** Query of every report endpoint: a local-day range and an optional location. */
export const ReportRangeQuery = z
  .object(rangeShape)
  .superRefine(checkRange)
  .meta({ id: 'ReportRangeQuery', description: RANGE_RULES });
export type ReportRangeQuery = z.infer<typeof ReportRangeQuery>;

export const TOP_PRODUCTS_ORDERS = ['revenue', 'quantity', 'profit'] as const;
export const TopProductsOrder = z.enum(TOP_PRODUCTS_ORDERS).meta({ id: 'TopProductsOrder' });
export type TopProductsOrder = z.infer<typeof TopProductsOrder>;

/** `GET /reports/top-products`: the range plus `by` and `limit` (1–50, default 10). */
export const TopProductsQuery = z
  .object({
    ...rangeShape,
    by: TopProductsOrder.default('revenue'),
    limit: z
      .union([z.string().regex(/^\d+$/).transform(Number), z.number()])
      .pipe(z.int().min(1).max(50))
      .default(10),
  })
  .superRefine(checkRange)
  .meta({ id: 'TopProductsQuery', description: RANGE_RULES });
export type TopProductsQuery = z.infer<typeof TopProductsQuery>;

const currency = z.enum(CURRENCIES);
/** Integer minor units, never negative (frozen `line_total` sums). */
const minorUnits = z.int().nonnegative();
/** Minor units with a sub-cent fraction (cost-based sums: numeric(20,6)). Profit may be negative. */
const decimalUnits = z.number().refine(Number.isFinite, 'Must be a finite number');
const COSTS_NOTE = "Null with scope 'own' (reports:view_own never sees costs, D4)";

/** Amount per currency, never converted between currencies (D6). Amounts may carry a sub-cent fraction. */
export const MoneyByCurrency = z
  .array(z.object({ currency, amount: decimalUnits.nonnegative().meta({ description: 'Minor units, up to 6 decimals' }) }))
  .meta({ id: 'MoneyByCurrency', description: 'One entry per currency with data' });
export type MoneyByCurrency = z.infer<typeof MoneyByCurrency>;

/** KPIs of one currency over the range (spec SP4, "KPIs"). */
export const SummaryTotals = z
  .object({
    currency,
    cashSales: minorUnits,
    transferSales: minorUnits,
    totalSales: minorUnits,
    profit: decimalUnits.nullable().meta({ description: `Gross profit. ${COSTS_NOTE}` }),
    margin: z.number().nullable().meta({ description: `profit / totalSales, 4 decimals; null without sales. ${COSTS_NOTE}` }),
    tickets: z.int().nonnegative().meta({ description: 'Distinct sales with at least one line in this currency' }),
    averageTicket: minorUnits.nullable().meta({ description: 'round(totalSales / tickets); null without tickets' }),
    shrinkageLoss: decimalUnits.nonnegative().nullable().meta({ description: COSTS_NOTE }),
    ownerWithdrawals: decimalUnits.nonnegative().nullable().meta({ description: COSTS_NOTE }),
    valuedEntries: decimalUnits.nonnegative().nullable().meta({ description: COSTS_NOTE }),
  })
  .meta({ id: 'SummaryTotals' });
export type SummaryTotals = z.infer<typeof SummaryTotals>;

export const REPORT_SCOPES = ['location', 'own'] as const;
export const ReportScope = z
  .enum(REPORT_SCOPES)
  .meta({ id: 'ReportScope', description: "'own': only the actor's sales of the location, without costs (reports:view_own)" });
export type ReportScope = z.infer<typeof ReportScope>;

/**
 * The tenant time zone as a response echoes it. `TimeZone` validates on write only (tenant:create):
 * Node's ICU zone list changes between versions (it lists Europe/Kiev and omits Europe/Kyiv), so a
 * stored zone is never re-validated against it on a read, where a mismatch would be a 500 (ADR 0007).
 */
const StoredTimeZone = z
  .string()
  .min(1)
  .meta({ description: 'IANA time zone stored for the tenant (validated when it was written)', example: 'America/Havana' });

/** What every ranged report echoes back: the resolved range and the cut-off instant. */
const rangeEcho = {
  from: LocalDate,
  to: LocalDate,
  timeZone: StoredTimeZone,
  /** Database now(): later occurrences are not counted. */
  asOf: IsoDateTime,
};
const locationIds = z.array(Uuid).meta({ description: 'Locations the report covers (only authorized ones)' });

/** `GET /reports/summary`. */
export const ReportSummary = z
  .object({ scope: ReportScope, locationIds, ...rangeEcho, currencies: z.array(SummaryTotals) })
  .meta({ id: 'ReportSummary' });
export type ReportSummary = z.infer<typeof ReportSummary>;

/** `GET /reports/daily-series`: one point per local day (days without sales are 0). */
export const DailySeries = z
  .object({
    locationIds,
    ...rangeEcho,
    series: z.array(
      z.object({
        currency,
        points: z.array(z.object({ date: LocalDate, totalSales: minorUnits, profit: decimalUnits })),
      }),
    ),
  })
  .meta({ id: 'DailySeries' });
export type DailySeries = z.infer<typeof DailySeries>;

/** `GET /reports/top-products`. */
export const TopProducts = z
  .object({
    locationIds,
    ...rangeEcho,
    by: TopProductsOrder,
    items: z.array(
      z.object({
        productId: Uuid,
        name: z.string(),
        unitOfMeasure: z.string(),
        currency,
        quantity: z.number().nonnegative().meta({ description: 'Units sold, at most 3 decimals' }),
        totalSales: minorUnits,
        profit: decimalUnits,
      }),
    ),
  })
  .meta({ id: 'TopProducts' });
export type TopProducts = z.infer<typeof TopProducts>;

/** `GET /reports/by-location`: a compact summary per visible location. */
export const SummaryByLocation = z
  .object({
    ...rangeEcho,
    locations: z.array(z.object({ locationId: Uuid, locationName: z.string(), currencies: z.array(SummaryTotals) })),
  })
  .meta({ id: 'SummaryByLocation' });
export type SummaryByLocation = z.infer<typeof SummaryByLocation>;

const healthItem = {
  productId: Uuid,
  locationId: Uuid,
  name: z.string(),
  unitOfMeasure: z.string(),
  quantity: z.number().meta({ description: 'Current stock, at most 3 decimals' }),
};
function healthList<T extends z.ZodRawShape>(extra: T) {
  return z.object({
    count: z.int().nonnegative().meta({ description: 'Total in the list, beyond the returned items' }),
    items: z.array(z.object({ ...healthItem, ...extra })).max(MAX_HEALTH_ITEMS),
  });
}

/** `GET /reports/inventory-health`: at the moment, not by range. */
export const InventoryHealth = z
  .object({
    locationIds,
    timeZone: TimeZone,
    asOf: IsoDateTime,
    lowStock: healthList({ threshold: z.number().meta({ description: 'Effective threshold (getProductThreshold)' }) }),
    stagnant: healthList({ lastSaleDate: LocalDate.nullable().meta({ description: 'Local day of the last sale; null if never sold' }) }),
    nearExpiration: healthList({ expirationDate: LocalDate }),
    /** Σ stock × average cost per currency. */
    inventoryValue: MoneyByCurrency,
  })
  .meta({ id: 'InventoryHealth' });
export type InventoryHealth = z.infer<typeof InventoryHealth>;
