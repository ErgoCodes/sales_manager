import { accountRedirectFor, accountRouteFor } from '../routes';
import type { SessionState } from '../session';

describe('accountRouteFor', () => {
  it.each([
    [{ status: 'signedOut' as const }, '/account/login'],
    [{ status: 'signedOut' as const, notice: 'sessionEnded' as const }, '/account/login'],
    [{ status: 'mustChangePassword' as const, me: null }, '/account/change-password'],
    [{ status: 'loading' as const }, null],
    [{ status: 'unsupported' as const }, null],
    [{ status: 'unreachable' as const }, null],
  ])('sends %o to %s', (state, route) => {
    expect(accountRouteFor(state)).toBe(route);
  });

  it('keeps a signed-in user on the account screen', () => {
    expect(
      accountRouteFor({
        status: 'signedIn',
        me: {
          user: { id: 'u', email: 'a@b.c', displayName: 'A', mustChangePassword: false },
          tenant: { id: 't', name: 'T', slug: 't' },
          deviceId: 'd',
          permissions: [],
        },
      }),
    ).toBe('/account');
  });
});

describe('accountRedirectFor', () => {
  const signedIn: SessionState = {
    status: 'signedIn',
    me: {
      user: { id: 'u', email: 'a@b.c', displayName: 'A', mustChangePassword: false },
      tenant: { id: 't', name: 'T', slug: 't' },
      deviceId: 'd',
      permissions: [],
    },
  };

  it('lets a signed-in user stay on the account screen and on "Hoy"', () => {
    expect(accountRedirectFor(signedIn, '/account')).toBeNull();
    expect(accountRedirectFor(signedIn, '/account/today')).toBeNull();
  });

  it('sends a signed-in user away from the login and password screens to the account screen', () => {
    expect(accountRedirectFor(signedIn, '/account/login')).toBe('/account');
    expect(accountRedirectFor(signedIn, '/account/change-password')).toBe('/account');
  });

  it('sends a signed-out user from "Hoy" to the login, and a pending password change to its screen', () => {
    expect(accountRedirectFor({ status: 'signedOut' }, '/account/today')).toBe('/account/login');
    expect(accountRedirectFor({ status: 'mustChangePassword', me: null }, '/account/today')).toBe('/account/change-password');
  });

  it('decides nothing while loading or unreachable', () => {
    expect(accountRedirectFor({ status: 'loading' }, '/account/today')).toBeNull();
    expect(accountRedirectFor({ status: 'unreachable' }, '/account/today')).toBeNull();
  });
});
