import type { SessionState } from './session';

export type AccountRoute = '/account' | '/account/login' | '/account/change-password' | '/account/today';

/** Screens a signed-in session may be on; `accountRouteFor` sends it to the first one. */
const SIGNED_IN_ROUTES: readonly AccountRoute[] = ['/account', '/account/today'];

/**
 * Where the account section must be for a session state; `null` while there is nothing
 * to decide (loading, unsupported platform, server unreachable). A pending password
 * change leaves only the change screen reachable.
 */
export function accountRouteFor(state: SessionState): AccountRoute | null {
  switch (state.status) {
    case 'signedOut':
      return '/account/login';
    case 'mustChangePassword':
      return '/account/change-password';
    case 'signedIn':
      return '/account';
    default:
      return null;
  }
}

/** Where a screen on `current` must redirect for a session state; `null` when it may stay. */
export function accountRedirectFor(state: SessionState, current: AccountRoute): AccountRoute | null {
  const target = accountRouteFor(state);
  if (target === null || target === current) return null;
  if (state.status === 'signedIn' && SIGNED_IN_ROUTES.includes(current)) return null;
  return target;
}
