import { CURRENCIES, LocalDate, TOP_PRODUCTS_ORDERS, type CurrencyCode, type TopProductsOrder } from '@monaco/contracts';
import { parseId } from '@/lib/admin/form-ids';

/**
 * Dashboard periods. The presets stay within 30 days, the window the reports latency budget covers
 * (ADR 0007, "Resultados medidos"); a custom range goes to the API as typed and the API validates it.
 */
export const PERIODS = ['hoy', '7d', '30d', 'rango'] as const;
export type Period = (typeof PERIODS)[number];
export const PRESETS = ['hoy', '7d', '30d'] as const satisfies readonly Period[];
type Preset = (typeof PRESETS)[number];

export const PERIOD_LABELS: Record<Period, string> = { hoy: 'Hoy', '7d': '7 días', '30d': '30 días', rango: 'Rango' };
const PRESET_DAYS: Record<Preset, number> = { hoy: 1, '7d': 7, '30d': 30 };

export const ORDER_LABELS: Record<TopProductsOrder, string> = { revenue: 'Ventas', quantity: 'Cantidad', profit: 'Utilidad' };

/** What the URL says (`?punto`, `?periodo`, `?desde`, `?hasta`, `?moneda`, `?orden`): a link reproduces the view. */
export interface DashboardFilters {
  period: Period;
  /** Only with `period: 'rango'`. */
  from?: string;
  to?: string;
  /** Absent: every location the user may report on ("Todos mis puntos"). */
  locationId?: string;
  /** Absent: the first currency with data. */
  currency?: CurrencyCode;
  order: TopProductsOrder;
}

export type DashboardSearch = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined) => (typeof value === 'string' && value !== '' ? value : undefined);
const isOneOf = <T extends string>(list: readonly T[], value: string | undefined): value is T => value !== undefined && (list as readonly string[]).includes(value);
const isDate = (value: string | undefined): value is string => value !== undefined && LocalDate.safeParse(value).success;

/** Unknown or malformed values are dropped (defaults apply) rather than sent to the API. */
export function parseFilters(search: DashboardSearch): DashboardFilters {
  const filters: DashboardFilters = { period: 'hoy', order: 'revenue' };
  const punto = single(search.punto);
  const locationId = punto ? parseId(punto) : null;
  if (locationId) filters.locationId = locationId;

  const desde = single(search.desde);
  const hasta = single(search.hasta);
  const periodo = single(search.periodo);
  if (isDate(desde) && isDate(hasta)) Object.assign(filters, { period: 'rango', from: desde, to: hasta });
  else if (isOneOf(PRESETS, periodo)) filters.period = periodo;

  const moneda = single(search.moneda);
  if (isOneOf(CURRENCIES, moneda)) filters.currency = moneda;
  const orden = single(search.orden);
  if (isOneOf(TOP_PRODUCTS_ORDERS, orden)) filters.order = orden;
  return filters;
}

/** `/tablero` with the given filters (and patch); defaults are left out, so the bare URL is "today, every location". */
export function dashboardHref(filters: DashboardFilters, patch: Partial<DashboardFilters> = {}): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.locationId) params.set('punto', next.locationId);
  if (next.period === 'rango') {
    if (next.from && next.to) {
      params.set('desde', next.from);
      params.set('hasta', next.to);
    }
  } else if (next.period !== 'hoy') params.set('periodo', next.period);
  if (next.currency) params.set('moneda', next.currency);
  if (next.order !== 'revenue') params.set('orden', next.order);
  const query = params.toString();
  return query ? `/tablero?${query}` : '/tablero';
}

/** The local calendar day of `instant` in `timeZone` (`YYYY-MM-DD`). */
export function todayIn(timeZone: string, instant: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/** Calendar arithmetic on a `YYYY-MM-DD` day (UTC midnight, so no DST shift). */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** True when the period needs the tenant's "today" to resolve its dates. */
export const needsToday = (filters: DashboardFilters) => filters.period === '7d' || filters.period === '30d';

/**
 * The `from`/`to` sent to the API. `hoy` sends none: the API resolves today in the tenant zone.
 * The 7- and 30-day presets end on `today` (the tenant's local day), both ends inclusive.
 */
export function resolveRange(filters: DashboardFilters, today?: string): { from: string; to: string } | undefined {
  if (filters.period === 'rango') return filters.from && filters.to ? { from: filters.from, to: filters.to } : undefined;
  if (filters.period === 'hoy' || !today) return undefined;
  return { from: addDays(today, -(PRESET_DAYS[filters.period] - 1)), to: today };
}

/**
 * Suspense keys for the dashboard cards: a changed key shows that card's loading state again. The ranking
 * order only feeds the top-products card, so switching it leaves every other card in place.
 */
export function cardKeys(filters: DashboardFilters): { shared: string; top: string } {
  const { order, ...rest } = filters;
  const shared = JSON.stringify(rest);
  return { shared, top: `${shared}|${order}` };
}
