import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../single-flight';

describe('createSingleFlight', () => {
  it('shares one promise between concurrent calls with the same key', async () => {
    const run = createSingleFlight<string>();
    let release!: (v: string) => void;
    const work = vi.fn(() => new Promise<string>((r) => (release = r)));
    const a = run('k', work);
    const b = run('k', work);
    release('ok');
    await expect(Promise.all([a, b])).resolves.toEqual(['ok', 'ok']);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('does not share between different keys', async () => {
    const run = createSingleFlight<number>();
    const work = vi.fn(async () => 1);
    await Promise.all([run('a', work), run('b', work)]);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it('forgets the key after settling, on success and on failure', async () => {
    const run = createSingleFlight<number>();
    const work = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(2);
    await expect(run('k', work)).rejects.toThrow('x');
    await expect(run('k', work)).resolves.toBe(2);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
