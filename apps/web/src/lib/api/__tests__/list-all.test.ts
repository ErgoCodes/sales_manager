import { describe, expect, it, vi } from 'vitest';
import { listAll } from '../list-all';

describe('listAll', () => {
  it('follows cursors until the last page', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [1, 2], nextCursor: 'c1' } })
      .mockResolvedValueOnce({ ok: true, data: { items: [3], nextCursor: null } });
    expect(await listAll(fetchPage)).toEqual({ ok: true, data: [1, 2, 3] });
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'c1');
  });

  it('propagates the first failure', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: false, status: 403, message: 'x' });
    expect(await listAll(fetchPage)).toEqual({ ok: false, status: 403, message: 'x' });
  });

  it('stops at the page cap instead of looping forever', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, data: { items: [1], nextCursor: 'again' } });
    const result = await listAll(fetchPage, 3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ ok: true, data: [1, 1, 1] });
  });
});
