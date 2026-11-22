import { formatCurrency, fromMinorUnits } from '@monaco/domain';
import createClient from 'openapi-fetch';

import type { components, paths } from '@/lib/api/schema';
import { BASE_URL, createFakeApi, json, me as baseMe } from '@/lib/session/__tests__/fake-api';

import {
  createTodayMemory,
  loadTodayLocations,
  refreshToday,
  todayView,
  type TodayLocation,
  type TodayState,
} from '../today';

type Me = components['schemas']['MeResponse_Output'];
type Grant = Me['permissions'][number];
type Summary = components['schemas']['ReportSummary_Output'];
type Health = components['schemas']['InventoryHealth_Output'];

const CENTRO = '0190a000-0000-7000-8000-0000000000c1';
const PLAYA = '0190a000-0000-7000-8000-0000000000c2';
const ARCHIVED = '0190a000-0000-7000-8000-0000000000c3';
const PRODUCT = '0190a000-0000-7000-8000-0000000000d1';

function meWith(permissions: Grant[]): Me {
  return { ...baseMe(), permissions };
}

function location(id: string, name: string, archivedAt: string | null = null) {
  return { id, name, code: name.slice(0, 3).toUpperCase(), archivedAt, createdAt: '2026-11-01T12:00:00.000Z' };
}

const LOCATIONS = [location(CENTRO, 'Centro'), location(PLAYA, 'Playa'), location(ARCHIVED, 'Viejo', '2026-11-10T12:00:00.000Z')];

function totals(currency: 'CUP' | 'USD' | 'MLC', own = false): Summary['currencies'][number] {
  return {
    currency,
    cashSales: 150_000,
    transferSales: 50_050,
    totalSales: 200_050,
    profit: own ? null : 61_234.5,
    margin: own ? null : 0.3061,
    tickets: 12,
    averageTicket: 16_671,
    shrinkageLoss: own ? null : 0,
    ownerWithdrawals: own ? null : 0,
    valuedEntries: own ? null : 0,
  };
}

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    scope: 'location',
    locationIds: [CENTRO],
    from: '2026-11-22',
    to: '2026-11-22',
    timeZone: 'America/Havana',
    // 19:05 UTC is 14:05 in Havana (UTC-5 in November).
    asOf: '2026-11-22T19:05:41.000Z',
    currencies: [totals('CUP'), totals('USD')],
    ...overrides,
  };
}

function health(): Health {
  return {
    locationIds: [CENTRO],
    timeZone: 'America/Havana',
    asOf: '2026-11-22T19:05:41.000Z',
    lowStock: {
      count: 3,
      items: [{ productId: PRODUCT, locationId: CENTRO, name: 'Arroz', unitOfMeasure: 'kg', quantity: 2.5, threshold: 5 }],
    },
    stagnant: { count: 0, items: [] },
    nearExpiration: {
      count: 1,
      items: [{ productId: PRODUCT, locationId: CENTRO, name: 'Yogur', unitOfMeasure: 'u', quantity: 4, expirationDate: '2026-11-25' }],
    },
    inventoryValue: [{ currency: 'CUP', amount: 1_000_000 }],
  };
}

function setup() {
  const fake = createFakeApi();
  const api = createClient<paths>({ baseUrl: BASE_URL, fetch: fake.fetch });
  const queryOf = (path: string) => {
    const request = fake.fetch.mock.calls.map(([r]) => r).find((r) => new URL(r.url).pathname === path);
    return request ? Object.fromEntries(new URL(request.url).searchParams) : undefined;
  };
  return { fake, api, queryOf, memory: createTodayMemory() };
}

const money = (minor: number, currency: string) => `${formatCurrency(fromMinorUnits(minor))} ${currency}`;
const qty = (value: number) => value.toLocaleString('es-CU', { maximumFractionDigits: 3 });

const FULL: TodayLocation = { id: CENTRO, name: 'Centro', canViewLocation: true };
const OWN: TodayLocation = { id: CENTRO, name: 'Centro', canViewLocation: false };

describe('loadTodayLocations', () => {
  it('offers the active locations where /me grants reports:view or reports:view_own, with names from /locations', async () => {
    const { fake, api } = setup();
    fake.on('GET /locations', json(200, { items: LOCATIONS, nextCursor: null }));
    const me = meWith([
      { permission: 'reports:view', scope: { type: 'locations', locationIds: [CENTRO] } },
      { permission: 'reports:view_own', scope: { type: 'locations', locationIds: [PLAYA, ARCHIVED] } },
      { permission: 'catalog:view', scope: { type: 'tenant' } },
    ]);

    await expect(loadTodayLocations(api, me)).resolves.toEqual({
      ok: true,
      locations: [
        { id: CENTRO, name: 'Centro', canViewLocation: true },
        { id: PLAYA, name: 'Playa', canViewLocation: false },
      ],
    });
  });

  it('gives every active location with a tenant-wide reports:view grant, following the pages', async () => {
    const { fake, api } = setup();
    fake.on(
      'GET /locations',
      json(200, { items: [LOCATIONS[0]], nextCursor: 'page-2' }),
      json(200, { items: [LOCATIONS[1], LOCATIONS[2]], nextCursor: null }),
    );
    const me = meWith([{ permission: 'reports:view', scope: { type: 'tenant' } }]);

    const result = await loadTodayLocations(api, me);

    expect(result).toEqual({
      ok: true,
      locations: [
        { id: CENTRO, name: 'Centro', canViewLocation: true },
        { id: PLAYA, name: 'Playa', canViewLocation: true },
      ],
    });
    expect(fake.callsTo('GET /locations')).toHaveLength(2);
    expect(new URL(fake.fetch.mock.calls[1][0].url).searchParams.get('cursor')).toBe('page-2');
  });

  it('offers nothing, without calling the API, when /me has no report permission', async () => {
    const { fake, api } = setup();
    const me = meWith([{ permission: 'sales:create', scope: { type: 'tenant' } }]);

    await expect(loadTodayLocations(api, me)).resolves.toEqual({ ok: true, locations: [] });
    expect(fake.calls).toHaveLength(0);
  });

  it('reports the server as unavailable on a network error', async () => {
    const { fake, api } = setup();
    fake.on('GET /locations', new TypeError('Network request failed'));
    const me = meWith([{ permission: 'reports:view', scope: { type: 'tenant' } }]);

    await expect(loadTodayLocations(api, me)).resolves.toEqual({ ok: false });
  });
});

describe('refreshToday', () => {
  it("asks for today's summary of the location without dates, plus inventory health with reports:view", async () => {
    const { fake, api, queryOf, memory } = setup();
    fake.on('GET /reports/summary', json(200, summary()));
    fake.on('GET /reports/inventory-health', json(200, health()));

    const state = await refreshToday(api, memory, 'user-1', FULL);

    expect(queryOf('/reports/summary')).toEqual({ locationId: CENTRO });
    expect(queryOf('/reports/inventory-health')).toEqual({ locationId: CENTRO });
    expect(state).toEqual({ status: 'ready', offline: false, snapshot: { summary: summary(), health: health() } });
  });

  it('never asks for inventory health with only reports:view_own', async () => {
    const { fake, api, memory } = setup();
    fake.on('GET /reports/summary', json(200, summary({ scope: 'own', currencies: [totals('CUP', true)] })));

    const state = await refreshToday(api, memory, 'user-1', OWN);

    expect(fake.callsTo('GET /reports/inventory-health')).toHaveLength(0);
    expect(state).toMatchObject({ status: 'ready', offline: false, snapshot: { health: null } });
  });

  it('keeps showing the last data in memory, marked offline, when the network fails', async () => {
    const { fake, api, memory } = setup();
    fake.on('GET /reports/summary', json(200, summary()), new TypeError('Network request failed'));
    fake.on('GET /reports/inventory-health', json(200, health()), new TypeError('Network request failed'));

    await refreshToday(api, memory, 'user-1', FULL);
    const state = await refreshToday(api, memory, 'user-1', FULL);

    expect(state).toEqual({ status: 'ready', offline: true, snapshot: { summary: summary(), health: health() } });
  });

  it('is offline without data when the network fails before anything was loaded', async () => {
    const { fake, api, memory } = setup();
    fake.on('GET /reports/summary', new TypeError('Network request failed'));

    await expect(refreshToday(api, memory, 'user-1', OWN)).resolves.toEqual({ status: 'offline' });
  });

  it("treats a server error or an unrefreshable session (401) as offline, and never shows another user's data", async () => {
    const { fake, api, memory } = setup();
    fake.on('GET /reports/summary', json(200, summary()), json(503), json(401));
    fake.on('GET /reports/inventory-health', json(200, health()));

    await refreshToday(api, memory, 'user-1', FULL);

    await expect(refreshToday(api, memory, 'user-1', FULL)).resolves.toMatchObject({ status: 'ready', offline: true });
    await expect(refreshToday(api, memory, 'user-2', FULL)).resolves.toEqual({ status: 'offline' });
  });

  it('says access was denied on a 403, without showing old data', async () => {
    const { fake, api, memory } = setup();
    fake.on('GET /reports/summary', json(200, summary()), json(403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } }));
    fake.on('GET /reports/inventory-health', json(200, health()));

    await refreshToday(api, memory, 'user-1', FULL);

    await expect(refreshToday(api, memory, 'user-1', FULL)).resolves.toEqual({ status: 'forbidden' });
  });

  it('forgets everything on clear (logout)', async () => {
    const { fake, api, memory } = setup();
    fake.on('GET /reports/summary', json(200, summary()), new TypeError('Network request failed'));
    fake.on('GET /reports/inventory-health', json(200, health()));

    await refreshToday(api, memory, 'user-1', FULL);
    memory.clear();

    await expect(refreshToday(api, memory, 'user-1', FULL)).resolves.toEqual({ status: 'offline' });
  });
});

describe('todayView', () => {
  const ready = (snapshot: { summary: Summary; health: Health | null }, offline = false): TodayState => ({
    status: 'ready',
    offline,
    snapshot,
  });

  it('shows the server header with the HH:mm of asOf in the tenant time zone', () => {
    const view = todayView(ready({ summary: summary(), health: null }));
    expect(view.header).toBe('Datos del servidor · actualizado 14:05');
    expect(view.notice).toBeNull();
  });

  it('shows one card per currency with sales by payment method, tickets and profit (scope location)', () => {
    const view = todayView(ready({ summary: summary(), health: null }));

    expect(view.currencies.map((card) => card.currency)).toEqual(['CUP', 'USD']);
    expect(view.currencies[1].rows).toEqual([
      { label: 'Efectivo', value: money(150_000, 'USD') },
      { label: 'Transferencia', value: money(50_050, 'USD') },
      { label: 'Total', value: money(200_050, 'USD') },
      { label: 'Tickets', value: '12' },
      { label: 'Utilidad', value: money(61_234.5, 'USD') },
    ]);
  });

  it("hides the profit with scope 'own'", () => {
    const view = todayView(ready({ summary: summary({ scope: 'own', currencies: [totals('CUP', true)] }), health: null }));

    expect(view.currencies).toHaveLength(1);
    expect(view.currencies[0].rows.map((row) => row.label)).toEqual(['Efectivo', 'Transferencia', 'Total', 'Tickets']);
  });

  it("hides the profit with scope 'own' even if a value came back", () => {
    const view = todayView(ready({ summary: summary({ scope: 'own', currencies: [totals('CUP')] }), health: null }));
    expect(view.currencies[0].rows.map((row) => row.label)).not.toContain('Utilidad');
  });

  it('says there are no sales yet when no currency has data', () => {
    const view = todayView(ready({ summary: summary({ currencies: [] }), health: null }));
    expect(view.currencies).toEqual([]);
    expect(view.message).toBe('Todavía no hay ventas hoy.');
  });

  it('lists low stock and near expiration only when inventory health was loaded', () => {
    expect(todayView(ready({ summary: summary(), health: null })).health).toBeNull();

    const view = todayView(ready({ summary: summary(), health: health() }));
    expect(view.health).toEqual([
      { title: 'Bajo stock', count: 3, items: [{ key: `${CENTRO}:${PRODUCT}`, name: 'Arroz', detail: `${qty(2.5)} kg (mínimo ${qty(5)})` }] },
      { title: 'Por vencer', count: 1, items: [{ key: `${CENTRO}:${PRODUCT}`, name: 'Yogur', detail: 'Vence el 25/11/2026' }] },
    ]);
  });

  it('shows "Sin conexión" over the last data when offline', () => {
    const view = todayView(ready({ summary: summary(), health: null }, true));
    expect(view.notice).toBe('Sin conexión');
    expect(view.header).toBe('Datos del servidor · actualizado 14:05');
    expect(view.currencies).toHaveLength(2);
  });

  it('shows "Sin conexión" and a message when offline without data', () => {
    const view = todayView({ status: 'offline' });
    expect(view).toEqual({
      notice: 'Sin conexión',
      header: null,
      message: 'No se pudo conectar con el servidor.',
      currencies: [],
      health: null,
    });
  });

  it('explains a denied access and a pending load', () => {
    expect(todayView({ status: 'forbidden' }).message).toBe('No tienes acceso a los reportes de este punto.');
    expect(todayView({ status: 'loading' })).toEqual({ notice: null, header: null, message: null, currencies: [], health: null });
  });
});
