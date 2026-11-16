/** Concurrent calls with the same key share one in-flight promise; the key is forgotten once it settles. */
export function createSingleFlight<T>() {
  const inflight = new Map<string, Promise<T>>();
  return (key: string, work: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = work().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}
