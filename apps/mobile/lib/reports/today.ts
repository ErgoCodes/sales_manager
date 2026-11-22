import { formatCurrency, fromMinorUnits } from '@monaco/domain';
import type { Client } from 'openapi-fetch';

import type { components, paths } from '@/lib/api/schema';

type Me = components['schemas']['MeResponse_Output'];
type Grant = Me['permissions'][number];
type Location = components['schemas']['Location_Output'];
type Summary = components['schemas']['ReportSummary_Output'];
type Health = components['schemas']['InventoryHealth_Output'];

export type ReportsApi = Client<paths>;

/** A location the "Hoy" picker offers. `canViewLocation`: `reports:view` there (profit and inventory health). */
export interface TodayLocation {
  id: string;
  name: string;
  canViewLocation: boolean;
}

export interface TodaySnapshot {
  summary: Summary;
  /** Only loaded with `reports:view` on the location. */
  health: Health | null;
}

export type TodayState =
  | { status: 'loading' }
  /** `offline`: the last refresh failed and `snapshot` is the last data kept in memory. */
  | { status: 'ready'; offline: boolean; snapshot: TodaySnapshot }
  | { status: 'offline' }
  | { status: 'forbidden' };

/** UI hint from `GET /me`; the API stays the authority and re-checks every request. */
function grants(permissions: readonly Grant[], permission: Grant['permission'], locationId: string): boolean {
  return permissions.some(
    (g) => g.permission === permission && (g.scope.type === 'tenant' || g.scope.locationIds.includes(locationId)),
  );
}

function hasReportPermission(me: Me): boolean {
  return me.permissions.some((g) => g.permission === 'reports:view' || g.permission === 'reports:view_own');
}

const LOCATIONS_PAGE_SIZE = 100;

/**
 * The active locations where `/me` grants `reports:view` or `reports:view_own`, named from
 * `GET /locations`. `{ ok: false }` when the server cannot be reached.
 */
export async function loadTodayLocations(
  api: ReportsApi,
  me: Me,
): Promise<{ ok: true; locations: TodayLocation[] } | { ok: false }> {
  if (!hasReportPermission(me)) return { ok: true, locations: [] };
  const all: Location[] = [];
  let cursor: string | undefined;
  try {
    do {
      const { data } = await api.GET('/locations', {
        params: { query: { limit: LOCATIONS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      });
      if (!data) return { ok: false };
      all.push(...data.items);
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
  } catch {
    return { ok: false };
  }
  return {
    ok: true,
    locations: all
      .filter((l) => l.archivedAt === null)
      .filter((l) => grants(me.permissions, 'reports:view', l.id) || grants(me.permissions, 'reports:view_own', l.id))
      .map((l) => ({ id: l.id, name: l.name, canViewLocation: grants(me.permissions, 'reports:view', l.id) })),
  };
}

/** Server data kept only in memory, never persisted (that is SP5). Keyed by user and location. */
export interface TodayMemory {
  get(key: string): TodaySnapshot | undefined;
  set(key: string, snapshot: TodaySnapshot): void;
  clear(): void;
}

export function createTodayMemory(): TodayMemory {
  const snapshots = new Map<string, TodaySnapshot>();
  return {
    get: (key) => snapshots.get(key),
    set: (key, snapshot) => void snapshots.set(key, snapshot),
    clear: () => snapshots.clear(),
  };
}

type Outcome<T> = { kind: 'ok'; data: T } | { kind: 'forbidden' } | { kind: 'unavailable' };

/** 403/404 are a definitive "not yours"; anything else (network, 401 without refresh, 5xx) is offline. */
async function outcome<T>(request: () => Promise<{ data?: T; response: Response }>): Promise<Outcome<T>> {
  try {
    const { data, response } = await request();
    if (data) return { kind: 'ok', data };
    return response.status === 403 || response.status === 404 ? { kind: 'forbidden' } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * Loads today's summary of the location (no dates: the server decides the day) and, with
 * `reports:view`, its inventory health. Offline, it falls back to the last snapshot in memory.
 */
export async function refreshToday(
  api: ReportsApi,
  memory: TodayMemory,
  userId: string,
  location: TodayLocation,
): Promise<TodayState> {
  const key = `${userId}:${location.id}`;
  const query = { locationId: location.id };
  const [summary, health] = await Promise.all([
    outcome(() => api.GET('/reports/summary', { params: { query } })),
    location.canViewLocation
      ? outcome(() => api.GET('/reports/inventory-health', { params: { query } }))
      : Promise.resolve<Outcome<null>>({ kind: 'ok', data: null }),
  ]);

  if (summary.kind === 'forbidden' || health.kind === 'forbidden') return { status: 'forbidden' };
  if (summary.kind === 'unavailable' || health.kind === 'unavailable') {
    const last = memory.get(key);
    return last ? { status: 'ready', offline: true, snapshot: last } : { status: 'offline' };
  }
  const snapshot: TodaySnapshot = { summary: summary.data, health: health.data };
  memory.set(key, snapshot);
  return { status: 'ready', offline: false, snapshot };
}

export interface TodayRow {
  label: string;
  value: string;
}

export interface TodayCurrencyCard {
  currency: string;
  rows: TodayRow[];
}

export interface TodayHealthList {
  title: string;
  count: number;
  items: { key: string; name: string; detail: string }[];
}

export interface TodayView {
  /** "Sin conexión" when the data shown (if any) could not be refreshed. */
  notice: string | null;
  header: string | null;
  message: string | null;
  currencies: TodayCurrencyCard[];
  health: TodayHealthList[] | null;
}

const LOCALE = 'es-CU';

function money(minor: number, currency: string): string {
  return `${formatCurrency(fromMinorUnits(minor))} ${currency}`;
}

function quantity(value: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 3 });
}

/** `HH:mm` of an instant in the tenant time zone; the device zone if the runtime lacks it. */
function clockTime(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(LOCALE, options).format(new Date(iso));
  }
}

/** `YYYY-MM-DD` (a local day, never an instant) as `DD/MM/YYYY`. */
function localDay(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function currencyCard(totals: Summary['currencies'][number], showProfit: boolean): TodayCurrencyCard {
  const rows: TodayRow[] = [
    { label: 'Efectivo', value: money(totals.cashSales, totals.currency) },
    { label: 'Transferencia', value: money(totals.transferSales, totals.currency) },
    { label: 'Total', value: money(totals.totalSales, totals.currency) },
    { label: 'Tickets', value: String(totals.tickets) },
  ];
  if (showProfit && totals.profit !== null) rows.push({ label: 'Utilidad', value: money(totals.profit, totals.currency) });
  return { currency: totals.currency, rows };
}

function healthLists(health: Health): TodayHealthList[] {
  return [
    {
      title: 'Bajo stock',
      count: health.lowStock.count,
      items: health.lowStock.items.map((item) => ({
        key: `${item.locationId}:${item.productId}`,
        name: item.name,
        detail: `${quantity(item.quantity)} ${item.unitOfMeasure} (mínimo ${quantity(item.threshold)})`,
      })),
    },
    {
      title: 'Por vencer',
      count: health.nearExpiration.count,
      items: health.nearExpiration.items.map((item) => ({
        key: `${item.locationId}:${item.productId}`,
        name: item.name,
        detail: `Vence el ${localDay(item.expirationDate)}`,
      })),
    },
  ];
}

const EMPTY: TodayView = { notice: null, header: null, message: null, currencies: [], health: null };

/** What the "Hoy" screen shows for a state: labels in Spanish, amounts already formatted. */
export function todayView(state: TodayState): TodayView {
  switch (state.status) {
    case 'loading':
      return EMPTY;
    case 'offline':
      return { ...EMPTY, notice: 'Sin conexión', message: 'No se pudo conectar con el servidor.' };
    case 'forbidden':
      return { ...EMPTY, message: 'No tienes acceso a los reportes de este punto.' };
    case 'ready': {
      const { summary, health } = state.snapshot;
      // `scope: 'own'` (reports:view_own) never shows profit, whatever the payload says (D4).
      const showProfit = summary.scope !== 'own';
      const currencies = summary.currencies.map((totals) => currencyCard(totals, showProfit));
      return {
        notice: state.offline ? 'Sin conexión' : null,
        header: `Datos del servidor · actualizado ${clockTime(summary.asOf, summary.timeZone)}`,
        message: currencies.length === 0 ? 'Todavía no hay ventas hoy.' : null,
        currencies,
        health: health ? healthLists(health) : null,
      };
    }
  }
}
