import { describe, expect, it, vi } from 'vitest';
import { createRefresher, type RefreshResult } from '../refresh';

const ok: RefreshResult = { kind: 'ok', accessToken: 'a2', expiresIn: 600, refreshToken: 'r2' };

describe('createRefresher', () => {
  it('two simultaneous refreshes of one session hit the API once and both get the rotated token', async () => {
    let release!: (r: RefreshResult) => void;
    const call = vi.fn((_token: string) => new Promise<RefreshResult>((r) => (release = r)));
    const refresh = createRefresher(call);
    const a = refresh('r1');
    const b = refresh('r1');
    release(ok);
    expect(await Promise.all([a, b])).toEqual([ok, ok]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![0]).toBe('r1');
  });

  it('different sessions do not share a flight', async () => {
    const call = vi.fn(async (_token: string) => ok);
    const refresh = createRefresher(call);
    await Promise.all([refresh('r1'), refresh('other')]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('after the flight settles, a later refresh (with the rotated token) calls the API again', async () => {
    const call = vi.fn(async (_token: string) => ok);
    const refresh = createRefresher(call);
    await refresh('r1');
    await refresh('r2');
    expect(call.mock.calls[1]![0]).toBe('r2');
  });

  it('shares a rejection too', async () => {
    const call = vi.fn(async (_token: string): Promise<RefreshResult> => ({ kind: 'rejected' }));
    const refresh = createRefresher(call);
    expect(await Promise.all([refresh('r1'), refresh('r1')])).toEqual([{ kind: 'rejected' }, { kind: 'rejected' }]);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
