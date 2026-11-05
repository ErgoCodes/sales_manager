import { describe, expect, it, vi } from 'vitest';

import type { DatabaseHealthPort } from '../../domain/database-health.port';
import { CheckHealth } from '../check-health.use-case';

// Unit tests of a use case use hand-written fakes of its ports: no Nest, no DB.
const fakeDatabase = (ping: DatabaseHealthPort['ping']): DatabaseHealthPort => ({ ping });

describe('CheckHealth', () => {
  it('reports ok when the database answers', async () => {
    const useCase = new CheckHealth(fakeDatabase(async () => true), '1.2.3');
    await expect(useCase.execute()).resolves.toEqual({ status: 'ok', version: '1.2.3', db: 'up' });
  });

  it('reports error when the database says it is unavailable', async () => {
    const useCase = new CheckHealth(fakeDatabase(async () => false), '1.2.3');
    await expect(useCase.execute()).resolves.toEqual({ status: 'error', version: '1.2.3', db: 'down' });
  });

  it('treats a rejected ping as down instead of throwing', async () => {
    const useCase = new CheckHealth(fakeDatabase(() => Promise.reject(new Error('ECONNREFUSED'))), '1.2.3');
    await expect(useCase.execute()).resolves.toMatchObject({ status: 'error', db: 'down' });
  });

  it('treats a ping slower than the timeout as down', async () => {
    vi.useFakeTimers();
    try {
      const useCase = new CheckHealth(fakeDatabase(() => new Promise(() => {})), '1.2.3', 50);
      const result = useCase.execute();
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toMatchObject({ db: 'down' });
    } finally {
      vi.useRealTimers();
    }
  });
});
