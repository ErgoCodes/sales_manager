import { renderToStaticMarkup } from 'react-dom/server';
import type { Mock } from 'vitest';
import type { PermissionGrant } from '@monaco/contracts';

/** Shared data and API routing for the inventory page tests (the mocks themselves live in each test file). */
export const P1 = '018f0000-0000-7000-8000-000000000001';
export const P2 = '018f0000-0000-7000-8000-000000000002';
export const L1 = '018f0000-0000-7000-8000-0000000000b1';
export const L2 = '018f0000-0000-7000-8000-0000000000b2';
export const D = '018f0000-0000-7000-8000-0000000000d1';
export const tenant = { type: 'tenant' } as const;
export const at = (...locationIds: string[]) => ({ type: 'locations', locationIds }) as const;

export const location = (id: string, name: string, archivedAt: string | null = null) => ({ id, name, code: name.toUpperCase(), archivedAt, createdAt: '2026-11-01T00:00:00.000Z' });
export const stockItem = (patch: Record<string, unknown> = {}) => ({
  productId: P1,
  name: 'Arroz',
  unitOfMeasure: 'kg',
  category: 'Granos',
  quantity: 12.5,
  lowStockThreshold: 6,
  isLow: false,
  averageCost: { amount: 8050, currency: 'CUP' },
  archivedAt: null,
  ...patch,
});
export const movement = (patch: Record<string, unknown> = {}) => ({
  id: '018f0000-0000-7000-8000-0000000000e1',
  documentId: D,
  locationId: L1,
  counterpartLocationId: null,
  counterpartLocationName: null,
  productId: P1,
  kind: 'entry',
  quantityDelta: 3,
  unitCost: { amount: 8000, currency: 'CUP' },
  reversesMovementId: null,
  createdAt: '2026-11-20T15:00:00.000Z',
  ...patch,
});
export const document_ = (patch: Record<string, unknown> = {}) => ({
  id: D,
  kind: 'transfer',
  locationId: L1,
  locationName: 'Centro',
  targetLocationId: null,
  targetLocationName: null,
  reason: null,
  reversesDocumentId: null,
  occurredAt: '2026-11-20T12:00:00.000Z',
  notes: 'Reposición',
  createdBy: '018f0000-0000-7000-8000-0000000000aa',
  createdAt: '2026-11-20T15:00:00.000Z',
  movements: [movement({ kind: 'transfer_out', quantityDelta: -2, unitCost: null })],
  ...patch,
});


export const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });
export const locations = () => page([location(L1, 'Centro'), location(L2, 'Norte')]);
export const html = async (element: Promise<React.ReactElement | null>) => renderToStaticMarkup((await element) ?? <></>);
export const search = (s: Record<string, string> = {}) => ({ searchParams: Promise.resolve(s) });

type Routes = Record<string, (query?: Record<string, unknown>, path?: Record<string, string>) => unknown>;
export type Call = { path: string; query?: Record<string, unknown>; params?: Record<string, string> };

/** Signs in with the given grants and routes every `callApi` by the path the page asked for, recording the calls. */
export function harness(getMe: Mock, callApi: Mock) {
  const calls: Call[] = [];
  const asUser = (...grants: [string, PermissionGrant['scope']][]) =>
    getMe.mockResolvedValue({ ok: true, data: { permissions: grants.map(([permission, scope]) => ({ permission, scope })) } });
  const serve = (routes: Routes) =>
    callApi.mockImplementation(async (fn: (api: unknown) => Promise<unknown>) => {
      let path = '';
      let options: { params?: { query?: Record<string, unknown>; path?: Record<string, string> } } = {};
      await fn({
        GET: async (p: string, o: typeof options) => {
          path = p;
          options = o;
          return {};
        },
      });
      calls.push({ path, query: options.params?.query, params: options.params?.path });
      const route = routes[path];
      if (!route) return { ok: false, status: 404, message: 'El registro no existe o ya no está disponible.' };
      const data = route(options.params?.query, options.params?.path);
      return data && typeof data === 'object' && 'ok' in data ? data : { ok: true, data };
    });
  const reset = () => {
    getMe.mockReset();
    callApi.mockReset();
    calls.length = 0;
  };
  return { asUser, serve, calls, reset };
}
