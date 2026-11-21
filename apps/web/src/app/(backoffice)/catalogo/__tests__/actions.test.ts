import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const patch = vi.fn();
const put = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post, PATCH: patch, PUT: put }) }));

import { archiveProductAction, createProductAction, setLocationPriceAction, updateProductAction } from '../actions';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const ok = (status = 200, data: unknown = {}) => ({ data, response: new Response(null, { status }) });
const fail = (status: number, code?: string) => ({ error: { error: { code } }, response: new Response(null, { status }) });
const ID = '018f0000-0000-7000-8000-000000000001';
const LOC = '018f0000-0000-7000-8000-0000000000b1';
const product = { name: 'Arroz', unitOfMeasure: 'kg', category: 'Granos', currency: 'CUP', costPrice: '80', cashPrice: '100', transferPrice: '110', lowStockThreshold: '', expirationDate: '' };

beforeEach(() => {
  for (const fn of [post, patch, put, revalidatePath]) fn.mockReset();
});

describe('createProductAction', () => {
  it('validates before calling the API', async () => {
    const state = await createProductAction({}, form({ ...product, cashPrice: '1.234' }));
    expect(state.error).toMatch(/importe/);
    expect(post).not.toHaveBeenCalled();
  });

  it('creates with minor units in the chosen currency and revalidates the list', async () => {
    post.mockResolvedValue(ok(201));
    expect(await createProductAction({}, form(product))).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        body: {
          name: 'Arroz',
          unitOfMeasure: 'kg',
          category: 'Granos',
          currency: 'CUP',
          costPrice: { amount: 8000, currency: 'CUP' },
          cashPrice: { amount: 10000, currency: 'CUP' },
          transferPrice: { amount: 11000, currency: 'CUP' },
          lowStockThreshold: null,
          expirationDate: null,
        },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/catalogo');
  });

  it('shows the 403 from the API in Spanish', async () => {
    post.mockResolvedValue(fail(403));
    expect((await createProductAction({}, form(product))).error).toMatch(/No tienes permiso/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateProductAction', () => {
  it('patches the product with every base price, so a currency change restates them all', async () => {
    patch.mockResolvedValue(ok());
    expect(await updateProductAction({}, form({ ...product, id: ID, currency: 'USD', transferPrice: '' }))).toEqual({ done: true });
    expect(patch).toHaveBeenCalledWith(
      '/products/{id}',
      expect.objectContaining({
        params: { path: { id: ID } },
        body: expect.objectContaining({ currency: 'USD', costPrice: { amount: 8000, currency: 'USD' }, cashPrice: { amount: 10000, currency: 'USD' }, transferPrice: null }),
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/catalogo');
    expect(revalidatePath).toHaveBeenCalledWith(`/catalogo/${ID}`);
  });

  it('leaves the cost out of the request when the form did not render it', async () => {
    patch.mockResolvedValue(ok());
    const { costPrice: _omit, ...withoutCost } = product;
    await updateProductAction({}, form({ ...withoutCost, id: ID }));
    expect(patch.mock.calls[0][1].body).not.toHaveProperty('costPrice');
  });

  it('explains a 422 CURRENCY_MISMATCH in Spanish', async () => {
    patch.mockResolvedValue(fail(422, 'CURRENCY_MISMATCH'));
    const state = await updateProductAction({}, form({ ...product, id: ID, currency: 'USD' }));
    expect(state.error).toMatch(/precios por punto/);
    expect(state.error).toMatch(/movimientos/);
  });

  it('rejects a malformed id without calling the API', async () => {
    expect((await updateProductAction({}, form({ ...product, id: 'nope' }))).error).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('archiveProductAction', () => {
  it('archives through POST and revalidates list and detail', async () => {
    post.mockResolvedValue(ok());
    expect(await archiveProductAction({}, form({ id: ID }))).toEqual({ done: true });
    expect(post).toHaveBeenCalledWith('/products/{id}/archive', expect.objectContaining({ params: { path: { id: ID } } }));
    expect(revalidatePath).toHaveBeenCalledWith(`/catalogo/${ID}`);
  });

  it('renders a 404 as a clear message', async () => {
    post.mockResolvedValue(fail(404));
    expect((await archiveProductAction({}, form({ id: ID }))).error).toMatch(/no existe/);
  });
});

describe('setLocationPriceAction', () => {
  const fields = { productId: ID, locationId: LOC, currency: 'CUP', cashPrice: '20', transferPrice: '' };

  it('puts the overrides in the product currency, empty meaning "remove"', async () => {
    put.mockResolvedValue(ok());
    expect(await setLocationPriceAction({}, form(fields))).toEqual({ done: true });
    expect(put).toHaveBeenCalledWith(
      '/locations/{locationId}/products/{productId}/price',
      expect.objectContaining({ params: { path: { locationId: LOC, productId: ID } }, body: { cashPrice: { amount: 2000, currency: 'CUP' }, transferPrice: null } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/catalogo/${ID}`);
  });

  it('rejects bad ids, currency or amounts without calling the API', async () => {
    expect((await setLocationPriceAction({}, form({ ...fields, locationId: 'x' }))).error).toBeTruthy();
    expect((await setLocationPriceAction({}, form({ ...fields, currency: 'EUR' }))).error).toBeTruthy();
    expect((await setLocationPriceAction({}, form({ ...fields, cashPrice: 'abc' }))).error).toMatch(/importe/);
    expect(put).not.toHaveBeenCalled();
  });

  it('shows a 409 ARCHIVED and a 403 in Spanish', async () => {
    put.mockResolvedValue(fail(409, 'ARCHIVED'));
    expect((await setLocationPriceAction({}, form(fields))).error).toMatch(/archivado/);
    put.mockResolvedValue(fail(403));
    expect((await setLocationPriceAction({}, form(fields))).error).toMatch(/No tienes permiso/);
  });
});
