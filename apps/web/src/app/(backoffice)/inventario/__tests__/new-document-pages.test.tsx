import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const callApi = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('@/lib/api/admin', () => ({ callApi: (...args: unknown[]) => callApi(...args), requestInit: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('../actions', () => ({ recordEntryAction: vi.fn(), recordExitAction: vi.fn(), recordAdjustmentAction: vi.fn() }));

import NewAdjustmentPage from '../ajustes/nuevo/page';
import NewEntryPage from '../entradas/nueva/page';
import NewExitPage from '../salidas/nueva/page';
import { at, harness, html, L1, location, locations, P2, page, search, stockItem, tenant } from './fixtures';

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
