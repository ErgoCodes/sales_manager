import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const callApi = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('@/lib/api/admin', () => ({ callApi: (...args: unknown[]) => callApi(...args), requestInit: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('../actions', () => ({ recordEntryAction: vi.fn(), recordExitAction: vi.fn(), recordAdjustmentAction: vi.fn(), recordTransferAction: vi.fn() }));

import NewAdjustmentPage from '../ajustes/nuevo/page';
import NewEntryPage from '../entradas/nueva/page';
import NewExitPage from '../salidas/nueva/page';
import NewTransferPage from '../transferencias/nueva/page';
import { at, harness, html, L1, L2, location, locations, P2, page, search, stockItem, tenant } from './fixtures';

const L3 = '018f0000-0000-7000-8000-0000000000b3';

const { asUser, serve, reset } = harness(getMe, callApi);
beforeEach(reset);

describe('new document pages', () => {
  it('generate a fresh UUIDv7 document id on every render', async () => {
    asUser(['inventory:write', at(L1)]);
    serve({ '/locations': locations, '/locations/{locationId}/stock': () => page([stockItem()]) });
    const first = await html(NewEntryPage(search({ locationId: L1 })));
    const second = await html(NewEntryPage(search({ locationId: L1 })));
    const id = (out: string) => /name="id" value="([^"]+)"/.exec(out)?.[1];
    expect(id(first)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id(first)).not.toBe(id(second));
    for (const text of ['Registrar entrada', 'Centro', 'Arroz', 'Costo unitario']) expect(first).toContain(text);
  });

  it('exit and adjustment forms list the products of the location', async () => {
    asUser(['inventory:write', at(L1)]);
    serve({ '/locations': locations, '/locations/{locationId}/stock': () => page([stockItem(), stockItem({ productId: P2, name: 'Viejo', archivedAt: '2026-11-01T00:00:00.000Z' })]) });
    const exit = await html(NewExitPage(search({ locationId: L1 })));
    for (const text of ['Registrar salida', 'Motivo', 'Merma', 'Viejo']) expect(exit).toContain(text);
    const adjustment = await html(NewAdjustmentPage(search({ locationId: L1 })));
    expect(adjustment).toContain('Registrar ajuste');
    const entry = await html(NewEntryPage(search({ locationId: L1 })));
    expect(entry).not.toContain('Viejo');
  });

  it('deny a location without inventory:write and an entry in an archived location', async () => {
    asUser(['inventory:view', at(L1)]);
    serve({ '/locations': locations, '/locations/{locationId}/stock': () => page([]) });
    expect(await html(NewExitPage(search({ locationId: L1 })))).toContain('No tienes acceso');
    expect(await html(NewExitPage(search({ locationId: 'nope' })))).toContain('No tienes acceso');
    asUser(['inventory:write', tenant]);
    serve({ '/locations': () => page([location(L1, 'Centro', '2026-11-10T00:00:00.000Z')]), '/locations/{locationId}/stock': () => page([]) });
    expect(await html(NewEntryPage(search({ locationId: L1 })))).toContain('archivado');
    expect(await html(NewExitPage(search({ locationId: L1 })))).toContain('Registrar salida');
  });
});

describe('new transfer page', () => {
  const three = () => page([location(L1, 'Centro'), location(L2, 'Norte'), location(L3, 'Sur', '2026-11-10T00:00:00.000Z')]);
  const options = (out: string, select: string) => {
    const block = new RegExp(`<select[^>]*name="${select}"[^>]*>([\\s\\S]*?)</select>`).exec(out)?.[1] ?? '';
    return [...block.matchAll(/<option[^>]*>([^<]*)/g)].map((m) => m[1]);
  };

  it('offers origins and destinations with inventory:transfer (D7), products from the origin, and a fresh id', async () => {
    asUser(['inventory:transfer', tenant]);
    serve({ '/locations': three, '/locations/{locationId}/stock': (_q, path) => page([stockItem({ name: path?.locationId === L2 ? 'Leche' : 'Arroz' })]) });
    const out = await html(NewTransferPage(search({ locationId: L2 })));
    for (const text of ['Registrar transferencia', 'Leche', 'Cambiar origen']) expect(out).toContain(text);
    expect(out).not.toContain('Arroz');
    expect(out).toMatch(new RegExp(`name="locationId" value="${L2}"`));
    expect(options(out, 'locationId')).toEqual(['Centro', 'Norte', 'Sur (archivado)']);
    expect(options(out, 'toLocationId')).toEqual(['Elige el destino', 'Centro']);
    const second = await html(NewTransferPage(search({ locationId: L2 })));
    const id = (s: string) => /name="id" value="([^"]+)"/.exec(s)?.[1];
    expect(id(out)).toMatch(/^[0-9a-f-]{36}$/);
    expect(id(out)).not.toBe(id(second));
  });

  it('only counts locations where the user can transfer', async () => {
    asUser(['inventory:transfer', at(L1, L2)], ['inventory:write', at(L3)]);
    serve({ '/locations': three, '/locations/{locationId}/stock': () => page([stockItem()]) });
    const out = await html(NewTransferPage(search()));
    expect(options(out, 'locationId')).toEqual(['Centro', 'Norte']);
    expect(options(out, 'toLocationId')).toEqual(['Elige el destino', 'Norte']);
  });

  it('denies an origin without inventory:transfer, and a user who can transfer in a single location', async () => {
    asUser(['inventory:transfer', at(L1, L2)], ['inventory:view', at(L3)]);
    serve({ '/locations': three, '/locations/{locationId}/stock': () => page([]) });
    expect(await html(NewTransferPage(search({ locationId: L3 })))).toContain('No tienes acceso');
    asUser(['inventory:transfer', at(L1)], ['inventory:write', at(L2)]);
    expect(await html(NewTransferPage(search({ locationId: L1 })))).toContain('No tienes acceso');
  });

  it('explains when no active destination remains', async () => {
    asUser(['inventory:transfer', tenant]);
    serve({ '/locations': () => page([location(L1, 'Centro'), location(L2, 'Norte', '2026-11-10T00:00:00.000Z')]), '/locations/{locationId}/stock': () => page([]) });
    expect(await html(NewTransferPage(search({ locationId: L1 })))).toContain('No hay otro punto de venta activo');
  });
});
