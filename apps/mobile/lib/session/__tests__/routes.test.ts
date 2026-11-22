import { accountRouteFor } from '../routes';

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
