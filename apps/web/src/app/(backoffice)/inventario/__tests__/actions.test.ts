import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post }) }));

import { recordAdjustmentAction, recordEntryAction, recordExitAction, recordTransferAction } from '../actions';

const ID = '018f0000-0000-7000-8000-0000000000d1';
const L = '018f0000-0000-7000-8000-0000000000b1';
const L2 = '018f0000-0000-7000-8000-0000000000b2';
const P1 = '018f0000-0000-7000-8000-000000000001';

function form(fields: Record<string, string>, lines: [string, string, string?][]) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const [productId, quantity, unitCost] of lines) {
    f.append('line-productId', productId);
    f.append('line-quantity', quantity);
    if (unitCost !== undefined) {
      f.append('line-unitCost', unitCost);
      f.append('line-currency', 'CUP');
    }
  }
  return f;
}
const base = { id: ID, locationId: L, occurredOn: '', notes: '' };
const ok = (status = 201) => ({ data: { id: ID }, response: new Response(null, { status }) });
const fail = (status: number, code?: string, details?: unknown) => ({ error: { error: { code, message: 'English text', details } }, response: new Response(null, { status }) });

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
});

describe('recordEntryAction', () => {
  it('posts the entry with the client id, revalidates inventory and catalog, and redirects to the stock', async () => {
    post.mockResolvedValue(ok());
    await expect(recordEntryAction({}, form(base, [[P1, '2.5', '80']]))).rejects.toThrow(`REDIRECT:/inventario?locationId=${L}&registrado=1`);
    expect(post).toHaveBeenCalledWith(
      '/inventory/entries',
      expect.objectContaining({ body: { id: ID, locationId: L, lines: [{ productId: P1, quantity: 2.5, unitCost: { amount: 8000, currency: 'CUP' } }] } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/inventario', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/catalogo', 'layout');
  });

  it('an idempotent retry (200 with the same document) also ends on the stock page', async () => {
    post.mockResolvedValue(ok(200));
    await expect(recordEntryAction({}, form(base, [[P1, '1', '1']]))).rejects.toThrow(/REDIRECT/);
  });

  it('validates before calling the API', async () => {
    expect((await recordEntryAction({}, form(base, [[P1, '0', '1']]))).error).toMatch(/mayor que 0/);
    expect((await recordEntryAction({}, form({ ...base, occurredOn: '2999-01-01' }, [[P1, '1', '1']]))).error).toMatch(/futura/);
    expect((await recordEntryAction({}, form({ ...base, id: 'nope' }, [[P1, '1', '1']]))).error).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('explains ARCHIVED, CURRENCY_MISMATCH and IDEMPOTENCY_CONFLICT in Spanish, without the API text', async () => {
    post.mockResolvedValue(fail(409, 'ARCHIVED'));
    expect((await recordEntryAction({}, form(base, [[P1, '1', '1']]))).error).toMatch(/archivado/);
    post.mockResolvedValue(fail(422, 'CURRENCY_MISMATCH'));
    expect((await recordEntryAction({}, form(base, [[P1, '1', '1']]))).error).toMatch(/moneda del producto/);
    post.mockResolvedValue(fail(409, 'IDEMPOTENCY_CONFLICT'));
    const state = await recordEntryAction({}, form(base, [[P1, '1', '1']]));
    expect(state.error).toMatch(/Recarga/);
    expect(state.error).not.toContain('English');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('recordExitAction', () => {
  it('posts the exit with its reason', async () => {
    post.mockResolvedValue(ok());
    await expect(recordExitAction({}, form({ ...base, reason: 'owner_withdrawal', occurredOn: '2026-01-02' }, [[P1, '1']]))).rejects.toThrow(/REDIRECT/);
    expect(post).toHaveBeenCalledWith(
      '/inventory/exits',
      expect.objectContaining({ body: { id: ID, locationId: L, reason: 'owner_withdrawal', occurredAt: '2026-01-02T12:00:00.000Z', lines: [{ productId: P1, quantity: 1 }] } }),
    );
  });

  it('returns the shortages of INSUFFICIENT_STOCK so the form can name the products', async () => {
    post.mockResolvedValue(fail(409, 'INSUFFICIENT_STOCK', [{ path: P1, message: 'Available 1.5, short by 0.5' }, { path: 'x', message: 'garbage' }]));
    const state = await recordExitAction({}, form({ ...base, reason: 'shrinkage' }, [[P1, '2']]));
    expect(state.error).toMatch(/stock suficiente/);
    expect(state.shortages).toEqual([
      { productId: P1, available: 1.5, shortBy: 0.5 },
      { productId: 'x', available: null, shortBy: null },
    ]);
  });

  it('shows a 403 in Spanish', async () => {
    post.mockResolvedValue(fail(403, 'FORBIDDEN'));
    expect((await recordExitAction({}, form({ ...base, reason: 'shrinkage' }, [[P1, '2']]))).error).toMatch(/No tienes permiso/);
  });
});

describe('recordAdjustmentAction', () => {
  it('posts signed deltas', async () => {
    post.mockResolvedValue(ok());
    await expect(recordAdjustmentAction({}, form({ ...base, notes: 'conteo' }, [[P1, '-3']]))).rejects.toThrow(/REDIRECT/);
    expect(post).toHaveBeenCalledWith('/inventory/adjustments', expect.objectContaining({ body: { id: ID, locationId: L, notes: 'conteo', lines: [{ productId: P1, quantityDelta: -3 }] } }));
  });
});

describe('recordTransferAction', () => {
  it('posts the transfer from the origin to the destination and returns to the origin stock', async () => {
    post.mockResolvedValue(ok());
    await expect(recordTransferAction({}, form({ ...base, toLocationId: L2 }, [[P1, '2']]))).rejects.toThrow(`REDIRECT:/inventario?locationId=${L}&registrado=1`);
    expect(post).toHaveBeenCalledWith('/inventory/transfers', expect.objectContaining({ body: { id: ID, fromLocationId: L, toLocationId: L2, lines: [{ productId: P1, quantity: 2 }] } }));
    expect(revalidatePath).toHaveBeenCalledWith('/inventario', 'layout');
  });

  it('rejects a missing or repeated destination before calling the API', async () => {
    expect((await recordTransferAction({}, form({ ...base, toLocationId: L }, [[P1, '2']]))).error).toMatch(/distinto del origen/);
    expect((await recordTransferAction({}, form({ ...base, toLocationId: 'nope' }, [[P1, '2']]))).error).toMatch(/destino/);
    expect((await recordTransferAction({}, form(base, [[P1, '2']]))).error).toMatch(/destino/);
    expect(post).not.toHaveBeenCalled();
  });

  it('maps INSUFFICIENT_STOCK shortages and ARCHIVED like the other documents', async () => {
    post.mockResolvedValue(fail(409, 'INSUFFICIENT_STOCK', [{ path: P1, message: 'Available 1, short by 1' }]));
    expect(await recordTransferAction({}, form({ ...base, toLocationId: L2 }, [[P1, '2']]))).toMatchObject({ shortages: [{ productId: P1, available: 1, shortBy: 1 }] });
    post.mockResolvedValue(fail(409, 'ARCHIVED'));
    expect((await recordTransferAction({}, form({ ...base, toLocationId: L2 }, [[P1, '2']]))).error).toMatch(/archivado/);
  });
});
