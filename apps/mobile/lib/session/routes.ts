import type { SessionState } from './session';

export type AccountRoute = '/account' | '/account/login' | '/account/change-password';

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
