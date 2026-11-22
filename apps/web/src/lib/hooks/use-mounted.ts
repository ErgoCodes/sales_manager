import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False while rendering on the server (and during hydration), true on the client afterwards.
 * Recharts sets inline `style` props; the CSP blocks style attributes in server HTML but allows
 * styles the client sets through the CSSOM, so charts render only once this is true.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
