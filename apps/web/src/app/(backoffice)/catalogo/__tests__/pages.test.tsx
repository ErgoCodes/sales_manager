import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionGrant } from '@monaco/contracts';

const getMe = vi.fn();
const callApi = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('@/lib/api/admin', () => ({ callApi: (...args: unknown[]) => callApi(...args), requestInit: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('../actions', () => ({ createProductAction: vi.fn(), updateProductAction: vi.fn(), archiveProductAction: vi.fn(), setLocationPriceAction: vi.fn() }));

import ProductPage from '../[id]/page';
import CatalogPage from '../page';

const P = '018f0000-0000-7000-8000-000000000001';
const L1 = '018f0000-0000-7000-8000-0000000000b1';
const L2 = '018f0000-0000-7000-8000-0000000000b2';
const tenant = { type: 'tenant' } as const;
const at = (...locationIds: string[]) => ({ type: 'locations', locationIds }) as const;
const asUser = (...grants: [string, PermissionGrant['scope']][]) =>
  getMe.mockResolvedValue({ ok: true, data: { permissions: grants.map(([permission, scope]) => ({ permission, scope })) } });

const cup = (amount: number) => ({ amount, currency: 'CUP' as const });
const product = {
  id: P,
  name: 'Arroz',
  unitOfMeasure: 'kg',
  category: 'Granos',
  currency: 'CUP',
  costPrice: cup(8000),
  cashPrice: cup(10000),
  transferPrice: cup(11000),
  lowStockThreshold: null,
  expirationDate: null,
  archivedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  effectiveCashPrice: cup(10000),
  effectiveTransferPrice: cup(11000),
  cashPriceOverride: null,
  transferPriceOverride: null,
};
const location = (id: string, name: string) => ({ id, name, code: name.toUpperCase(), archivedAt: null, createdAt: '2026-11-01T00:00:00.000Z' });

/** Routes every mocked `callApi` by the path the page asked for, and records the query. */
const calls: { path: string; query?: Record<string, unknown> }[] = [];
let stockFor: () => unknown = () => ({ ok: true, data: { productId: P, locations: [] } });
function serve(productFor: (query?: Record<string, unknown>) => unknown) {
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
    const query = options.params?.query;
    calls.push({ path, query });
    if (path === '/locations') return { ok: true, data: { items: [location(L1, 'Centro'), location(L2, 'Norte')], nextCursor: null } };
    if (path === '/products') return { ok: true, data: { items: [productFor(query)], nextCursor: null } };
    if (path === '/products/{id}/stock') return stockFor();
    return { ok: true, data: productFor(query) };
  });
}
const html = async (element: Promise<React.ReactElement | null>) => renderToStaticMarkup((await element) ?? <></>);

beforeEach(() => {
  getMe.mockReset();
  callApi.mockReset();
  calls.length = 0;
  stockFor = () => ({ ok: true, data: { productId: P, locations: [] } });
});

describe('catalog list page', () => {
  it('owner sees base prices, costs and the create action', async () => {
    asUser(['catalog:write', tenant], ['catalog:view', tenant]);
    serve(() => product);
    const out = await html(CatalogPage({ searchParams: Promise.resolve({}) }));
    for (const text of ['Nuevo producto', 'Costo', '$80.00 CUP', '$100.00 CUP', 'Precios base', `/catalogo/${P}`]) expect(out).toContain(text);
    expect(calls.find((c) => c.path === '/products')?.query).toMatchObject({ locationId: undefined });
  });

  it('cashier sees the catalog of their location, without write actions or costs', async () => {
    asUser(['catalog:view', at(L1)]);
    serve(() => ({ ...product, costPrice: null, effectiveCashPrice: cup(9000) }));
    const out = await html(CatalogPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain('$90.00 CUP');
    for (const text of ['Nuevo producto', 'Costo', 'Precios base', 'Norte']) expect(out).not.toContain(text);
    expect(calls.find((c) => c.path === '/products')?.query).toMatchObject({ locationId: L1 });
  });

  it('passes the filters to the API and ignores a location the user cannot read', async () => {
    asUser(['catalog:view', at(L1)]);
    serve(() => product);
    await html(CatalogPage({ searchParams: Promise.resolve({ q: ' arr ', category: 'Granos', archived: '1', locationId: L2 }) }));
    expect(calls.find((c) => c.path === '/products')?.query).toMatchObject({ q: 'arr', category: 'Granos', includeArchived: 'true', locationId: L1 });
  });

  it('denies a user without catalog permissions, and renders API failures as alerts', async () => {
    asUser(['sales:create', tenant]);
    expect(await html(CatalogPage({ searchParams: Promise.resolve({}) }))).toContain('No tienes acceso');
    asUser(['catalog:view', tenant]);
    callApi.mockResolvedValue({ ok: false, status: 503, message: 'El servicio no está disponible.' });
    expect(await html(CatalogPage({ searchParams: Promise.resolve({}) }))).toMatch(/role="alert"[^>]*>El servicio no está disponible/);
  });
});

describe('product detail page', () => {
  it('owner sees edit, archive and the price action in every location', async () => {
    asUser(['catalog:write', tenant]);
    serve((query) => (query?.locationId === L2 ? { ...product, cashPriceOverride: cup(12000), effectiveCashPrice: cup(12000) } : product));
    const out = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    for (const text of ['Editar', 'Archivar', 'Costo', '$80.00 CUP', 'Centro', 'Norte', '$120.00 CUP', 'propio del punto']) expect(out).toContain(text);
    expect(out.match(/Fijar precio/g)).toHaveLength(2);
  });

  it('manager with catalog:write in one location only sets that price, and cannot edit the product (D14)', async () => {
    asUser(['catalog:write', at(L1)], ['catalog:view', at(L1, L2)]);
    serve((query) => ({ ...product, costPrice: query?.locationId ? cup(8000) : null }));
    const out = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    expect(out.match(/Fijar precio/g)).toHaveLength(1);
    for (const text of ['Editar', 'Archivar', 'Costo']) expect(out).not.toContain(text);
  });

  it('cashier sees prices of their location only, without actions or costs', async () => {
    asUser(['catalog:view', at(L1)]);
    serve(() => ({ ...product, costPrice: null }));
    const out = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    expect(out).toContain('Centro');
    for (const text of ['Norte', 'Fijar precio', 'Editar', 'Archivar', 'Costo']) expect(out).not.toContain(text);
  });

  it('an archived product offers no write actions', async () => {
    asUser(['catalog:write', tenant]);
    serve(() => ({ ...product, archivedAt: '2026-11-10T00:00:00.000Z' }));
    const out = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    expect(out).toContain('Archivado');
    for (const text of ['Editar', 'Fijar precio']) expect(out).not.toContain(text);
  });

  it('renders a malformed id and a 404 as messages', async () => {
    expect(await html(ProductPage({ params: Promise.resolve({ id: 'nope' }) }))).toContain('no existe');
    asUser(['catalog:view', tenant]);
    callApi.mockResolvedValue({ ok: false, status: 404, message: 'El registro no existe o ya no está disponible.' });
    expect(await html(ProductPage({ params: Promise.resolve({ id: P }) }))).toContain('no existe');
  });

  it('shows the stock per visible location with average cost when the API returns it', async () => {
    asUser(['catalog:write', tenant], ['inventory:write', tenant]);
    serve(() => product);
    stockFor = () => ({
      ok: true,
      data: { productId: P, locations: [{ locationId: L1, locationName: 'Centro', quantity: 12.5, averageCost: { amount: 8050, currency: 'CUP' } }, { locationId: L2, locationName: 'Norte', quantity: 0, averageCost: { amount: 0, currency: 'CUP' } }] },
    });
    const out = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    for (const text of ['Stock por punto de venta', '12.5 kg', 'Costo promedio', '$80.50 CUP']) expect(out).toContain(text);
  });

  it('hides the average cost the API did not return, and the stock section without inventory access', async () => {
    asUser(['catalog:view', at(L1)], ['inventory:view', at(L1)]);
    serve(() => ({ ...product, costPrice: null }));
    stockFor = () => ({ ok: true, data: { productId: P, locations: [{ locationId: L1, locationName: 'Centro', quantity: 3, averageCost: null }] } });
    const out = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    expect(out).toContain('Stock por punto de venta');
    expect(out).toContain('3 kg');
    expect(out).not.toContain('Costo promedio');

    asUser(['catalog:view', at(L1)]);
    calls.length = 0;
    const noInventory = await html(ProductPage({ params: Promise.resolve({ id: P }) }));
    expect(noInventory).not.toContain('Stock por punto de venta');
    expect(calls.some((c) => c.path === '/products/{id}/stock')).toBe(false);

    asUser(['catalog:view', at(L1)], ['inventory:view', at(L1)]);
    stockFor = () => ({ ok: false, status: 503, message: 'El servicio no está disponible.' });
    expect(await html(ProductPage({ params: Promise.resolve({ id: P }) }))).toContain('El servicio no está disponible.');
  });
});
