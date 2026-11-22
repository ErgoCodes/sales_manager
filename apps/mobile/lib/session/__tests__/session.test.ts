import {
  BASE_URL,
  createFakeApi,
  deferred,
  DEVICE_ID,
  json,
  me,
  OTHER_DEVICE_ID,
  resetSecureStore,
  secureStoreData,
  secureStoreMock,
  tokens,
} from './fake-api';

import { PasswordChangeRequiredError, createSession, type SessionDeps } from '../session';
import { REFRESH_TOKEN_KEY, DEVICE_ID_KEY, createSecureStorage } from '../secure-storage';

// Hoisted above the imports by babel-jest.
jest.mock('expo-secure-store', () => jest.requireActual('./fake-api').secureStoreMock);

const SECURE_OPTIONS = { keychainAccessible: secureStoreMock.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function setup(overrides: Partial<SessionDeps> = {}) {
  const api = createFakeApi();
  let clock = 1_000_000;
  const session = createSession({
    baseUrl: BASE_URL,
    fetch: api.fetch,
    storage: createSecureStorage(),
    platform: 'android',
    now: () => clock,
    ...overrides,
  });
  return {
    api,
    session,
    advance(ms: number) {
      clock += ms;
    },
  };
}

async function signedIn() {
  const ctx = setup();
  ctx.api.on('POST /auth/login', json(200, tokens(1)));
  ctx.api.on('GET /me', json(200, me()));
  await ctx.session.login('owner@demo.test', 'correct horse battery');
  return ctx;
}

beforeEach(() => {
  resetSecureStore();
});

describe('login', () => {
  it('stores the refresh token and device id in secure storage and keeps the access token in memory', async () => {
    const { session, api } = setup();
    api.on('POST /auth/login', json(200, tokens(1)));
    api.on('GET /me', json(200, me()));

    const result = await session.login('owner@demo.test', 'correct horse battery');

    expect(result).toEqual({ ok: true });
    expect(api.callsTo('POST /auth/login')[0].body).toEqual({
      email: 'owner@demo.test',
      password: 'correct horse battery',
      device: { label: 'Android · Monaco', platform: 'android' },
    });
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledTimes(2);
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'refresh-1', SECURE_OPTIONS);
    expect(secureStoreMock.setItemAsync).toHaveBeenCalledWith(DEVICE_ID_KEY, DEVICE_ID, SECURE_OPTIONS);
    expect([...secureStoreData.values()]).not.toContain('access-1');
    expect(api.callsTo('GET /me')[0].authorization).toBe('Bearer access-1');
    expect(session.getState()).toEqual({ status: 'signedIn', me: me() });
  });

  it('sends the stored device id and the iOS label, and stores the device the API returns', async () => {
    secureStoreData.set(DEVICE_ID_KEY, DEVICE_ID);
    const { session, api } = setup({ platform: 'ios' });
    api.on('POST /auth/login', json(200, tokens(1, { deviceId: OTHER_DEVICE_ID })));
    api.on('GET /me', json(200, me()));

    await session.login('owner@demo.test', 'correct horse battery');

    expect(api.callsTo('POST /auth/login')[0].body).toMatchObject({
      deviceId: DEVICE_ID,
      device: { label: 'iOS · Monaco', platform: 'ios' },
    });
    expect(secureStoreData.get(DEVICE_ID_KEY)).toBe(OTHER_DEVICE_ID);
  });

  it.each([
    [json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }), 'invalidCredentials'],
    [json(400, { error: { code: 'VALIDATION_FAILED', message: 'Invalid' } }), 'invalidCredentials'],
    [json(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down' } }), 'rateLimited'],
    [json(503), 'unavailable'],
    [new TypeError('Network request failed'), 'unavailable'],
  ])('maps a failed login to a reason and stores nothing', async (reply, reason) => {
    const { session, api } = setup();
    await session.restore();
    api.on('POST /auth/login', reply);

    expect(await session.login('owner@demo.test', 'wrong password!!')).toEqual({ ok: false, reason });
    expect(secureStoreMock.setItemAsync).not.toHaveBeenCalled();
    expect(session.getState().status).toBe('signedOut');
  });
});

describe('refresh', () => {
  it('refreshes before the access token expires (30 s margin) and rotates the stored refresh token', async () => {
    const { session, api, advance } = await signedIn();
    api.on('POST /auth/refresh', json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 600 }));
    api.on('GET /me', json(200, me()));

    advance(569_000); // 31 s left: still valid
    await session.revalidate();
    expect(api.callsTo('POST /auth/refresh')).toHaveLength(0);

    advance(2_000); // 29 s left: refresh first
    await session.revalidate();
    expect(api.callsTo('POST /auth/refresh')[0].body).toEqual({ refreshToken: 'refresh-1' });
    expect(api.callsTo('GET /me').at(-1)?.authorization).toBe('Bearer access-2');
    expect(secureStoreMock.setItemAsync).toHaveBeenLastCalledWith(REFRESH_TOKEN_KEY, 'refresh-2', SECURE_OPTIONS);
  });

  it('shares one refresh call between two requests that get a 401 at the same time', async () => {
    const { session, api } = await signedIn();
    const gate = deferred<Response>();
    api.on(
      'GET /locations',
      json(401),
      json(401),
      json(200, { items: [] }),
    );
    api.on('POST /auth/refresh', () => gate.promise);

    const first = session.api.GET('/locations', {});
    const second = session.api.GET('/locations', {});
    await new Promise((r) => setTimeout(r, 0));
    gate.resolve(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 600 }));
    const [a, b] = await Promise.all([first, second]);

    expect(api.callsTo('POST /auth/refresh')).toHaveLength(1);
    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(api.callsTo('GET /locations').slice(2).map((c) => c.authorization)).toEqual([
      'Bearer access-2',
      'Bearer access-2',
    ]);
    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-2');
  });

  it('keeps the stored refresh token when the response comes from the grace window', async () => {
    const { session, api, advance } = await signedIn();
    api.on('POST /auth/refresh', json(200, { accessToken: 'access-2', expiresIn: 600 }));
    api.on('GET /me', json(200, me()));

    advance(600_000);
    await session.revalidate();

    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
    expect(api.callsTo('GET /me').at(-1)?.authorization).toBe('Bearer access-2');
    expect(session.getState().status).toBe('signedIn');
  });

  it('clears the session and goes back to login when the refresh is rejected (reuse or revocation)', async () => {
    const { session, api } = await signedIn();
    api.on('GET /me', json(401));
    api.on('POST /auth/refresh', json(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));

    await session.revalidate();

    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(secureStoreData.get(DEVICE_ID_KEY)).toBe(DEVICE_ID);
    expect(session.getState()).toEqual({ status: 'signedOut', notice: 'sessionEnded' });
  });

  it('keeps the session when the refresh fails for network, 429 or 5xx reasons', async () => {
    const { session, api, advance } = await signedIn();
    api.on('POST /auth/refresh', new TypeError('Network request failed'), json(429), json(503));

    for (let i = 0; i < 3; i++) {
      advance(600_000);
      expect(await session.refresh()).toBeNull();
    }

    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
    expect(session.getState().status).toBe('signedIn');
  });

  it('does not resurrect a session when logout happens while a refresh is in flight', async () => {
    const { session, api } = await signedIn();
    const gate = deferred<Response>();
    api.on('POST /auth/refresh', () => gate.promise);
    api.on('POST /auth/logout', json(204));

    const pending = session.refresh();
    await session.logout();
    gate.resolve(json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 600 }));

    expect(await pending).toBeNull();
    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(session.getState().status).toBe('signedOut');
  });
});

describe('restore and revalidate', () => {
  it('restores a stored session at startup through a refresh and GET /me', async () => {
    secureStoreData.set(REFRESH_TOKEN_KEY, 'refresh-1');
    secureStoreData.set(DEVICE_ID_KEY, DEVICE_ID);
    const { session, api } = setup();
    api.on('POST /auth/refresh', json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 600 }));
    api.on('GET /me', json(200, me()));

    await session.restore();

    expect(session.getState()).toEqual({ status: 'signedIn', me: me() });
    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-2');
  });

  it('is signed out at startup without a stored refresh token', async () => {
    const { session, api } = setup();
    await session.restore();
    expect(session.getState()).toEqual({ status: 'signedOut' });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('reports the server as unreachable at startup without network and keeps the stored session', async () => {
    secureStoreData.set(REFRESH_TOKEN_KEY, 'refresh-1');
    const { session, api } = setup();
    api.on('POST /auth/refresh', new TypeError('Network request failed'));

    await session.restore();

    expect(session.getState()).toEqual({ status: 'unreachable' });
    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('goes back to login when GET /me still answers 401 after a successful refresh', async () => {
    const { session, api } = await signedIn();
    api.on('GET /me', json(401));
    api.on('POST /auth/refresh', json(200, { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 600 }));

    await session.revalidate();

    expect(session.getState()).toEqual({ status: 'signedOut', notice: 'sessionEnded' });
    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
  });

  it('keeps the current user when GET /me fails for network reasons', async () => {
    const { session, api } = await signedIn();
    api.on('GET /me', new TypeError('Network request failed'));

    await session.revalidate();

    expect(session.getState()).toEqual({ status: 'signedIn', me: me() });
  });

  it('notifies subscribers on every state change until they unsubscribe', async () => {
    const { session, api } = setup();
    const seen: string[] = [];
    const unsubscribe = session.subscribe(() => seen.push(session.getState().status));
    api.on('POST /auth/login', json(200, tokens(1)));
    api.on('GET /me', json(200, me()));
    api.on('POST /auth/logout', json(204));

    await session.login('owner@demo.test', 'correct horse battery');
    unsubscribe();
    await session.logout();

    expect(seen).toEqual(['loading', 'signedIn']);
  });
});

describe('logout', () => {
  it('revokes the session in the API and clears secure storage and memory', async () => {
    const { session, api } = await signedIn();
    api.on('POST /auth/logout', json(204));

    await session.logout();

    expect(api.callsTo('POST /auth/logout')[0].authorization).toBe('Bearer access-1');
    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(session.getState()).toEqual({ status: 'signedOut' });
  });

  it('clears everything locally even without network', async () => {
    const { session, api } = await signedIn();
    api.on('POST /auth/logout', new TypeError('Network request failed'));

    await session.logout();

    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(session.getState()).toEqual({ status: 'signedOut' });
  });

  it('gives up on a hanging API after the timeout and still clears', async () => {
    const ctx = setup({ logoutTimeoutMs: 20 });
    ctx.api.on('POST /auth/login', json(200, tokens(1)));
    ctx.api.on('GET /me', json(200, me()));
    await ctx.session.login('owner@demo.test', 'correct horse battery');
    ctx.api.on('POST /auth/logout', () => new Promise<Response>(() => {}));

    await ctx.session.logout();

    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(ctx.session.getState().status).toBe('signedOut');
  });

  it('clears secure storage even when the API rejects the request', async () => {
    const { session, api } = await signedIn();
    api.on('POST /auth/logout', json(500));

    await session.logout();

    expect(secureStoreData.has(REFRESH_TOKEN_KEY)).toBe(false);
  });
});

describe('mandatory password change', () => {
  async function pendingChange() {
    const ctx = setup();
    ctx.api.on('POST /auth/login', json(200, tokens(1, { mustChangePassword: true })));
    ctx.api.on('GET /me', json(200, me({ mustChangePassword: true })));
    await ctx.session.login('owner@demo.test', 'temporary password');
    return ctx;
  }

  it('enters the mustChangePassword state after a login that requires it', async () => {
    const { session } = await pendingChange();
    expect(session.getState()).toEqual({ status: 'mustChangePassword', me: me({ mustChangePassword: true }) });
  });

  it('blocks every other API call without reaching the network', async () => {
    const { session, api } = await pendingChange();
    const before = api.calls.length;

    await expect(session.api.GET('/locations', {})).rejects.toBeInstanceOf(PasswordChangeRequiredError);
    expect(api.calls).toHaveLength(before);
  });

  it('changes the password, stores the new tokens and unlocks the session', async () => {
    const { session, api } = await pendingChange();
    api.on('POST /auth/password', json(200, tokens(2)));
    api.on('GET /me', json(200, me()));

    const result = await session.changePassword('temporary password', 'a brand new password');

    expect(result).toEqual({ ok: true });
    expect(api.callsTo('POST /auth/password')[0]).toMatchObject({
      authorization: 'Bearer access-1',
      body: { currentPassword: 'temporary password', newPassword: 'a brand new password' },
    });
    expect(secureStoreMock.setItemAsync).toHaveBeenLastCalledWith(DEVICE_ID_KEY, DEVICE_ID, SECURE_OPTIONS);
    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-2');
    expect(api.callsTo('GET /me').at(-1)?.authorization).toBe('Bearer access-2');
    expect(session.getState()).toEqual({ status: 'signedIn', me: me() });
  });

  it.each([
    [json(400, { error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Wrong' } }), 'invalidCurrentPassword'],
    [json(400, { error: { code: 'VALIDATION_FAILED', message: 'Too short' } }), 'invalidNewPassword'],
    [json(429), 'rateLimited'],
    [new TypeError('Network request failed'), 'unavailable'],
  ])('maps a failed password change to a reason and stays blocked', async (reply, reason) => {
    const { session, api } = await pendingChange();
    api.on('POST /auth/password', reply);

    expect(await session.changePassword('temporary password', 'a brand new password')).toEqual({ ok: false, reason });
    expect(session.getState().status).toBe('mustChangePassword');
    expect(secureStoreData.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('switches to mustChangePassword when the API answers PASSWORD_CHANGE_REQUIRED', async () => {
    const { session, api } = await signedIn();
    api.on('GET /locations', json(403, { error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change it' } }));

    const { response } = await session.api.GET('/locations', {});

    expect(response.status).toBe(403);
    expect(session.getState()).toEqual({ status: 'mustChangePassword', me: me() });
  });
});

describe('without a session', () => {
  it('rejects authenticated calls without reaching the network', async () => {
    const { session, api } = setup();
    const { response } = await session.api.GET('/locations', {});
    expect(response.status).toBe(401);
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
