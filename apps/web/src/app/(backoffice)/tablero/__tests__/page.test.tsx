import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionGrant } from '@monaco/contracts';

const getMe = vi.fn();
const callApi = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('@/lib/api/admin', () => ({ callApi: (...args: unknown[]) => callApi(...args), requestInit: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { byLocation, dailySeries, inventoryHealth, L1, L2, summary, topProducts } from '@/components/dashboard/__tests__/fixtures';
import DashboardPage from '../page';

type Scope = PermissionGrant['scope'];
const tenant: Scope = { type: 'tenant' };
const at = (...locationIds: string[]): Scope => ({ type: 'locations', locationIds });
const location = (id: string, name: string) => ({ id, name, code: name.toUpperCase(), archivedAt: null, createdAt: '2026-11-01T00:00:00.000Z' });

type Call = { path: string; query?: Record<string, unknown> };
let calls: Call[] = [];
let routes: Record<string, (query?: Record<string, unknown>) => unknown> = {};

const asUser = (...grants: [string, Scope][]) => getMe.mockResolvedValue({ ok: true, data: { permissions: grants.map(([permission, scope]) => ({ permission, scope })) } });
const serve = (patch: typeof routes = {}) => {
  routes = {
    '/locations': () => ({ items: [location(L1, 'Centro'), location(L2, 'Norte')], nextCursor: null }),
    '/reports/summary': () => summary(),
    '/reports/daily-series': () => dailySeries(),
    '/reports/top-products': (q) => topProducts((q?.by ?? 'revenue') as 'revenue'),
    '/reports/by-location': () => byLocation(),
    '/reports/inventory-health': () => inventoryHealth(),
    ...patch,
  };
};

beforeEach(() => {
  calls = [];
  getMe.mockReset();
  callApi.mockReset();
  callApi.mockImplementation(async (fn: (api: unknown) => Promise<unknown>) => {
    let path = '';
    let options: { params?: { query?: Record<string, unknown> } } = {};
    await fn({
      GET: async (p: string, o: typeof options) => {
        path = p;
        options = o;
        return {};
      },
    });
    calls.push({ path, query: options.params?.query });
    const route = routes[path];
    if (!route) return { ok: false, status: 404, message: 'El registro no existe o ya no está disponible.' };
    const data = route(options.params?.query);
    return data && typeof data === 'object' && 'ok' in data ? data : { ok: true, data };
  });
  serve();
});

async function render(search: Record<string, string> = {}) {
  const { prelude } = await prerender(await DashboardPage({ searchParams: Promise.resolve(search) }));
  return new Response(prelude).text();
}
const reportCalls = () => calls.filter((c) => c.path.startsWith('/reports/'));
const query = (path: string) => calls.find((c) => c.path === path)?.query;

describe('/tablero', () => {
  it('owner sees every card for today; five report calls, without dates (today in the tenant zone)', async () => {
    asUser(['reports:view', tenant]);
    const out = await render();
    for (const text of ['Tablero', 'Ventas totales', 'Utilidad bruta', 'Ventas diarias', 'Productos más vendidos', 'Arroz', 'Comparativa por punto', 'Centro', 'Norte', 'Salud del inventario', 'Valor del inventario', 'Todos mis puntos'])
      expect(out).toContain(text);
    expect(out).not.toMatch(/\sstyle="/);
    expect(reportCalls()).toHaveLength(5);
    expect(query('/reports/summary')).toEqual({ locationId: undefined });
    expect(query('/reports/top-products')).toEqual({ locationId: undefined, by: 'revenue', limit: 10 });
  });

  it('a 7-day preset ends on today in the tenant zone (from inventory-health) and the ranking keeps its order', async () => {
    asUser(['reports:view', tenant]);
    serve({ '/reports/inventory-health': () => inventoryHealth({ timeZone: 'America/Havana', asOf: '2026-11-22T03:00:00.000Z' }) });
    await render({ periodo: '7d', punto: L2, orden: 'profit' });
    expect(query('/reports/summary')).toEqual({ from: '2026-11-15', to: '2026-11-21', locationId: L2 });
    expect(query('/reports/daily-series')).toEqual({ from: '2026-11-15', to: '2026-11-21', locationId: L2 });
    expect(query('/reports/top-products')).toEqual({ from: '2026-11-15', to: '2026-11-21', locationId: L2, by: 'profit', limit: 10 });
    expect(query('/reports/inventory-health')).toEqual({ locationId: L2 });
    // One location chosen: no comparison call.
    expect(calls.some((c) => c.path === '/reports/by-location')).toBe(false);
  });

  it('the chosen currency filters the ranking (ranked per currency by the API)', async () => {
    asUser(['reports:view', tenant]);
    const usd = await render({ moneda: 'USD' });
    // Leche is also in the inventory health card: assert on the ranking table cells.
    const ranked = /<td[^>]*>Leche<\/td>/;
    expect(usd).toContain('Café importado');
    expect(usd).not.toMatch(ranked);
    const cup = await render();
    expect(cup).toMatch(ranked);
    expect(cup).not.toContain('Café importado');
  });

  it('manager only gets their own location in the selector', async () => {
    asUser(['reports:view', at(L1)], ['inventory:view', at(L1, L2)]);
    const out = await render();
    expect(out).toMatch(new RegExp(`<option value="${L1}"[^>]*>Centro</option>`));
    expect(out).not.toMatch(new RegExp(`<option value="${L2}"`));
  });

  it('a cashier (reports:view_own only) has no access and triggers no report call', async () => {
    asUser(['reports:view_own', at(L1)], ['sales:create', at(L1)]);
    expect(await render()).toContain('No tienes acceso');
    expect(reportCalls()).toHaveLength(0);
  });

  it.each([
    [400, /período no es válido/],
    [403, /No tienes permiso para ver los reportes/],
    [404, /punto de venta no existe/],
    [429, /Demasiadas consultas en poco tiempo/],
  ])('renders a %i as a Spanish error inside each card', async (status, message) => {
    asUser(['reports:view', tenant]);
    const failure = { ok: false, status, message: 'x' };
    serve({ '/reports/summary': () => failure, '/reports/daily-series': () => failure, '/reports/top-products': () => failure, '/reports/by-location': () => failure, '/reports/inventory-health': () => failure });
    const out = await render({ desde: '2026-11-10', hasta: '2026-11-01' });
    expect(out.match(new RegExp(`role="alert"[^>]*>[^<]*${message.source}`, 'g'))?.length).toBe(5);
  });

  it('shows empty states when the period has no sales', async () => {
    asUser(['reports:view', tenant]);
    serve({
      '/reports/summary': () => summary([]),
      '/reports/daily-series': () => ({ ...dailySeries(), series: [] }),
      '/reports/top-products': () => ({ ...topProducts(), items: [] }),
      '/reports/by-location': () => ({ ...byLocation(), locations: [] }),
    });
    const out = await render();
    expect(out).toContain('No hay ventas en este período.');
  });
});
