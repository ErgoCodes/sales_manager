import type { CurrencyCode, PermissionGrant } from '@monaco/contracts';
import { callApi, requestInit, type ApiResult } from '@/lib/api/admin';
import { listAll } from '@/lib/api/list-all';
import type { DailySeries, InventoryHealth, Location, ReportSummary, SummaryByLocation, TopProducts } from '@/lib/api/types';
import { canAt } from '@/lib/permissions';
import { needsToday, resolveRange, todayIn, type DashboardFilters } from '@/lib/reports/filters';

type Result<T> = Promise<ApiResult<T>>;
type Range = { from: string; to: string } | undefined;

/** Ranking size per currency (the API ranks and limits within each currency). */
export const TOP_LIMIT = 10;

/** Spanish messages for the report errors the dashboard can meet (spec SP4, "Errores"). */
export function reportErrorMessage(status: number, fallback: string): string {
  if (status === 400) return 'El período no es válido: la fecha inicial no puede ser posterior a la final y el rango admite hasta 366 días.';
  if (status === 403) return 'No tienes permiso para ver los reportes de este punto de venta.';
  if (status === 404) return 'El punto de venta no existe o ya no está disponible.';
  // `/reports/*` is throttled per IP (30/min per endpoint): say so instead of "too many attempts".
  if (status === 429) return 'Demasiadas consultas en poco tiempo. Espera un minuto y vuelve a cargar el tablero.';
  return fallback;
}

async function report<T>(call: Parameters<typeof callApi<T>>[0]): Result<T> {
  const result = await callApi(call, { canRefresh: false });
  return result.ok ? result : { ...result, message: reportErrorMessage(result.status, result.message) };
}

/** Locations offered by the filter: those where the user holds `reports:view` (the API re-checks every call). */
export async function reportLocations(grants: readonly PermissionGrant[]): Result<Location[]> {
  const all = await listAll((cursor) => callApi((api) => api.GET('/locations', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false }));
  return all.ok ? { ok: true, data: all.data.filter((l) => canAt(grants, 'reports:view', l.id)) } : all;
}

export interface DashboardData {
  summary: Result<ReportSummary>;
  series: Result<DailySeries>;
  top: Result<TopProducts>;
  /** Absent with one location chosen: there is nothing to compare. */
  byLocation?: Result<SummaryByLocation>;
  health: Result<InventoryHealth>;
  /** The URL's currency, else the first one with sales in the summary. */
  currency: Promise<CurrencyCode | undefined>;
}

/**
 * Starts the (at most) five report calls of one view, each awaited by its own card. No polling and no
 * cache: every endpoint is throttled per IP (30/min) and the data is private (spec SP4, "Cache").
 * The 7- and 30-day presets end on the tenant's today, read from the inventory-health response
 * (`timeZone`, `asOf`): /me carries no time zone and the server's clock zone is not the tenant's.
 */
export function loadDashboard(filters: DashboardFilters): DashboardData {
  const { locationId } = filters;
  const health = report((api) => api.GET('/reports/inventory-health', { params: { query: { locationId } }, ...requestInit() }));
  const range: Result<Range> = needsToday(filters)
    ? health.then((h) => (h.ok ? { ok: true, data: resolveRange(filters, todayIn(h.data.timeZone, h.data.asOf)) } : h))
    : Promise.resolve({ ok: true, data: resolveRange(filters) });
  const ranged = <T>(call: (query: { from?: string; to?: string; locationId?: string }) => Parameters<typeof callApi<T>>[0]): Result<T> =>
    range.then((r) => (r.ok ? report(call({ ...r.data, locationId })) : r));

  const summary = ranged<ReportSummary>((query) => (api) => api.GET('/reports/summary', { params: { query }, ...requestInit() }));
  const series = ranged<DailySeries>((query) => (api) => api.GET('/reports/daily-series', { params: { query }, ...requestInit() }));
  const top = ranged<TopProducts>((query) => (api) => api.GET('/reports/top-products', { params: { query: { ...query, by: filters.order, limit: TOP_LIMIT } }, ...requestInit() }));
  const byLocation = locationId ? undefined : ranged<SummaryByLocation>((query) => (api) => api.GET('/reports/by-location', { params: { query }, ...requestInit() }));
  const currency = summary.then((s) => filters.currency ?? (s.ok ? s.data.currencies[0]?.currency : undefined));
  return { summary, series, top, byLocation, health, currency };
}
