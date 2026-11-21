import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const callApi = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('@/lib/api/admin', () => ({ callApi: (...args: unknown[]) => callApi(...args), requestInit: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import DocumentPage from '../movimientos/[id]/page';
import MovementsPage from '../movimientos/page';
import InventoryPage from '../page';
import { at, D, document_, harness, html, L1, L2, location, locations, movement, P1, P2, page, search, stockItem, tenant } from './fixtures';

const { asUser, serve, calls, reset } = harness(getMe, callApi);
beforeEach(reset);

describe('inventory stock page', () => {
  it('manager sees the stock of their location with average cost, low stock and the write actions', async () => {
    asUser(['inventory:write', at(L1)], ['inventory:view', at(L1)]);
    serve({ '/locations': locations, '/locations/{locationId}/stock': () => page([stockItem(), stockItem({ productId: P2, name: 'Leche', quantity: 1, isLow: true })], 'next') });
    const out = await html(InventoryPage(search()));
    for (const text of ['Centro', 'Arroz', '12.5 kg', 'Costo promedio', '$80.50 CUP', 'Bajo stock', 'Registrar entrada', 'Registrar salida', 'Registrar ajuste', `/inventario/entradas/nueva?locationId=${L1}`, '/inventario/movimientos', 'Siguiente'])
      expect(out).toContain(text);
    expect(out).not.toContain('Norte');
    expect(calls.find((c) => c.path === '/locations/{locationId}/stock')?.params).toEqual({ locationId: L1 });
  });

  it('cashier sees stock without costs nor write actions, and a null cost is never a zero', async () => {
    asUser(['inventory:view', at(L1, L2)]);
    serve({ '/locations': locations, '/locations/{locationId}/stock': () => page([stockItem({ averageCost: null })]) });
    const out = await html(InventoryPage(search({ locationId: L2, q: ' arr ', low: '1' })));
    for (const text of ['Costo promedio', '$0.00', 'Registrar entrada', 'Registrar salida']) expect(out).not.toContain(text);
    expect(out).toContain('Norte');
    expect(calls.find((c) => c.path === '/locations/{locationId}/stock')).toMatchObject({ params: { locationId: L2 }, query: { q: 'arr', lowStockOnly: 'true' } });
  });

  it('confirms a registered document, and offers no entry in an archived location (D15)', async () => {
    asUser(['inventory:write', tenant]);
    serve({ '/locations': () => page([location(L1, 'Centro', '2026-11-10T00:00:00.000Z')]), '/locations/{locationId}/stock': () => page([]) });
    const out = await html(InventoryPage(search({ registrado: '1' })));
    expect(out).toContain('Documento registrado');
    expect(out).toContain('archivado');
    expect(out).toContain('Registrar salida');
    expect(out).not.toContain('Registrar entrada');
    expect(out).toContain('No hay productos para mostrar');
  });

  it('denies a user without inventory permissions, and renders API failures as alerts', async () => {
    asUser(['catalog:write', tenant]);
    expect(await html(InventoryPage(search()))).toContain('No tienes acceso');
    asUser(['inventory:view', tenant]);
    callApi.mockResolvedValue({ ok: false, status: 503, message: 'El servicio no está disponible.' });
    expect(await html(InventoryPage(search()))).toMatch(/role="alert"[^>]*>El servicio no está disponible/);
    asUser(['inventory:view', at(L1)]);
    serve({ '/locations': () => page([location(L2, 'Norte')]) });
    expect(await html(InventoryPage(search()))).toContain('No hay puntos de venta');
  });
});

describe('movements page', () => {
  it('lists the ledger with filters, product names, costs and the masked transfer counterpart', async () => {
    asUser(['inventory:write', at(L1)]);
    serve({
      '/locations': locations,
      '/locations/{locationId}/stock': () => page([stockItem()]),
      '/locations/{locationId}/inventory-movements': () =>
        page([movement(), movement({ id: 'm2', kind: 'transfer_out', quantityDelta: -2, unitCost: null }), movement({ id: 'm3', kind: 'transfer_in', counterpartLocationId: L2, counterpartLocationName: 'Norte', productId: P2 })], 'c2'),
    });
    const out = await html(MovementsPage(search({ productId: P1, kind: 'entry', from: '2026-11-01', to: '2026-11-20' })));
    for (const text of ['Movimientos', 'Arroz', 'Entrada', '+3', 'Transferencia enviada', 'Otro punto', 'Norte', 'Costo unitario', '$80.00 CUP', `/inventario/movimientos/${D}`, 'Siguiente'])
      expect(out).toContain(text);
    expect(out).not.toContain('Revertir');
    expect(calls.find((c) => c.path === '/locations/{locationId}/inventory-movements')?.query).toMatchObject({
      productId: P1,
      kind: 'entry',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-20T23:59:59.999Z',
    });
  });

  it('ignores invalid filters, hides costs the API did not return, and denies without access', async () => {
    asUser(['inventory:view', at(L1)]);
    serve({ '/locations': locations, '/locations/{locationId}/stock': () => page([]), '/locations/{locationId}/inventory-movements': () => page([movement({ unitCost: null, productId: P2 })]) });
    const out = await html(MovementsPage(search({ productId: 'x', kind: 'theft', from: 'ayer' })));
    expect(out).not.toContain('Costo unitario');
    expect(out).toContain('018f0000…');
    expect(calls.find((c) => c.path === '/locations/{locationId}/inventory-movements')?.query).toMatchObject({ productId: undefined, kind: undefined, from: undefined });
    asUser(['catalog:view', tenant]);
    expect(await html(MovementsPage(search()))).toContain('No tienes acceso');
  });
});

describe('document detail page', () => {
  it('shows the header and visible movements, masking the other location as "Otro punto", without a revert action', async () => {
    asUser(['inventory:view', at(L1)]);
    serve({ '/inventory/documents/{id}': () => document_(), '/locations/{locationId}/stock': () => page([stockItem()]) });
    const out = await html(DocumentPage({ params: Promise.resolve({ id: D }) }));
    for (const text of ['Transferencia', 'Centro', 'Otro punto', 'Reposición', 'Arroz', '-2', 'Transferencia enviada']) expect(out).toContain(text);
    expect(out).not.toContain('Revertir');
    expect(out).not.toContain('Costo unitario');
  });

  it('shows the exit reason, unit costs when returned, and a link to the reversed document', async () => {
    asUser(['inventory:write', tenant]);
    serve({
      '/inventory/documents/{id}': () => document_({ kind: 'exit', reason: 'shrinkage', notes: null, reversesDocumentId: P2, movements: [movement({ kind: 'shrinkage', quantityDelta: -1 })] }),
      '/locations/{locationId}/stock': () => page([stockItem()]),
    });
    const out = await html(DocumentPage({ params: Promise.resolve({ id: D }) }));
    for (const text of ['Salida', 'Merma', 'Costo unitario', '$80.00 CUP', `/inventario/movimientos/${P2}`]) expect(out).toContain(text);
  });

  it('renders a malformed id, a 404 and a user without access as messages', async () => {
    expect(await html(DocumentPage({ params: Promise.resolve({ id: 'nope' }) }))).toContain('no existe');
    asUser(['inventory:view', tenant]);
    serve({});
    expect(await html(DocumentPage({ params: Promise.resolve({ id: D }) }))).toContain('no existe');
    asUser(['catalog:view', tenant]);
    expect(await html(DocumentPage({ params: Promise.resolve({ id: D }) }))).toContain('No tienes acceso');
  });
});
