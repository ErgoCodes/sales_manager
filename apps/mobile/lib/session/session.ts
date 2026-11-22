import createClient, { type Client } from 'openapi-fetch';

import type { components, paths } from '@/lib/api/schema';

import { DEVICE_ID_KEY, REFRESH_TOKEN_KEY, type SecureStorage } from './secure-storage';

export type Me = components['schemas']['MeResponse_Output'];

export type SessionState =
  /** Expo web: there is no secure storage, so there is no online session. */
  | { status: 'unsupported' }
  | { status: 'loading' }
  /** `sessionEnded`: the API rejected the session (expired, revoked, reuse detected). */
  | { status: 'signedOut'; notice?: 'sessionEnded' }
  /** A session is stored but the server could not be reached to resume it. */
  | { status: 'unreachable' }
  /** Only the password change (and logout) is allowed until it is done. */
  | { status: 'mustChangePassword'; me: Me | null }
  | { status: 'signedIn'; me: Me };

export type LoginResult = { ok: true } | { ok: false; reason: 'invalidCredentials' | 'rateLimited' | 'unavailable' };
export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'invalidCurrentPassword' | 'invalidNewPassword' | 'rateLimited' | 'unavailable' };

export interface SessionDeps {
  /** API base URL without a trailing slash. */
  baseUrl: string;
  fetch: (request: Request) => Promise<Response>;
  storage: SecureStorage;
  platform: 'android' | 'ios';
  now?: () => number;
  logoutTimeoutMs?: number;
}

export interface Session {
  /** Typed client for authenticated calls: adds the bearer and refreshes once on a 401. */
  api: Client<paths>;
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  /** At startup: resumes a stored session (refresh + `GET /me`). */
  restore(): Promise<void>;
  login(email: string, password: string): Promise<LoginResult>;
  changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult>;
  /** Revokes the session in the API (best effort, short timeout) and always clears it locally. */
  logout(): Promise<void>;
  /** On returning to the foreground: re-reads `GET /me` so revocations and role changes show up. */
  revalidate(): Promise<void>;
  /** Single-flight refresh; resolves to the new access token or `null`. */
  refresh(): Promise<string | null>;
}

/** Thrown, without a network call, for any request other than these while a password change is pending. */
export class PasswordChangeRequiredError extends Error {
  constructor() {
    super('Password change required');
    this.name = 'PasswordChangeRequiredError';
  }
}

/** Mirrors `@AllowPendingPasswordChange()` in the API (ADR 0004 §4). */
const ALLOWED_WHILE_PENDING = new Set(['POST /auth/password', 'POST /auth/logout', 'GET /me']);

/** Refresh this long before the access token expires (spec: 30 s margin). */
const EXPIRY_MARGIN_MS = 30_000;
const DEFAULT_LOGOUT_TIMEOUT_MS = 3_000;
/** A refresh that hangs would block every request queued behind the single flight. */
export const REFRESH_TIMEOUT_MS = 10_000;

const TIMED_OUT = Symbol('timedOut');

/** Runs `work` with an abort signal and settles with `TIMED_OUT` after `ms` if it has not. */
async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const PLATFORM_LABEL = { android: 'Android', ios: 'iOS' } as const;

type RefreshOutcome = { kind: 'ok'; accessToken: string } | { kind: 'rejected' } | { kind: 'unavailable' };

/** 429 and 5xx say nothing about the credentials or the session; any other 4xx is a definitive no. */
function isTransient(status: number): boolean {
  return status >= 500 || status === 429;
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function withBearer(request: Request, token: string): Request {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return new Request(request, { headers });
}

export function createSession(deps: SessionDeps): Session {
  const now = deps.now ?? Date.now;
  const logoutTimeoutMs = deps.logoutTimeoutMs ?? DEFAULT_LOGOUT_TIMEOUT_MS;

  /**
   * Secure storage operations run one after another, in call order: a slow write of a
   * rotated refresh token can never land after the delete of a logout that came later.
   */
  let storageChain: Promise<unknown> = Promise.resolve();
  function serial<T>(op: () => Promise<T>): Promise<T> {
    const run = storageChain.then(op, op);
    storageChain = run.catch(() => undefined);
    return run;
  }
  const storage: SecureStorage = {
    get: (key) => serial(() => deps.storage.get(key)),
    set: (key, value) => serial(() => deps.storage.set(key, value)),
    delete: (key) => serial(() => deps.storage.delete(key)),
  };

  let state: SessionState = { status: 'loading' };
  const listeners = new Set<() => void>();

  let access: { token: string; expiresAt: number } | null = null;
  /** `undefined`: not read from storage yet. */
  let refreshToken: string | null | undefined;
  let inflightRefresh: Promise<RefreshOutcome> | null = null;
  /** Bumped whenever the session is cleared or replaced, so late results of an older session are dropped. */
  let generation = 0;

  function setState(next: SessionState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function currentMe(): Me | null {
    return state.status === 'signedIn' || state.status === 'mustChangePassword' ? state.me : null;
  }

  const publicApi = createClient<paths>({ baseUrl: deps.baseUrl, fetch: deps.fetch });

  async function storedRefreshToken(): Promise<string | null> {
    if (refreshToken === undefined) refreshToken = await storage.get(REFRESH_TOKEN_KEY);
    return refreshToken;
  }

  async function saveTokens(tokens: { accessToken: string; expiresIn: number; refreshToken?: string; deviceId?: string }) {
    access = { token: tokens.accessToken, expiresAt: now() + tokens.expiresIn * 1000 };
    if (tokens.refreshToken) {
      refreshToken = tokens.refreshToken;
      await storage.set(REFRESH_TOKEN_KEY, tokens.refreshToken);
    }
    if (tokens.deviceId) await storage.set(DEVICE_ID_KEY, tokens.deviceId);
  }

  /**
   * Forgets the session secrets. The device id stays (it is not a secret): the next login
   * reuses the device, and the API only does so for the same user and a non-revoked device.
   */
  async function clearLocal(next: SessionState) {
    generation++;
    access = null;
    refreshToken = null;
    inflightRefresh = null;
    setState(next);
    try {
      await storage.delete(REFRESH_TOKEN_KEY);
    } catch {
      // Memory is already clear; a leftover entry is overwritten by the next login.
    }
  }

  async function callRefresh(): Promise<RefreshOutcome> {
    const token = await storedRefreshToken();
    if (!token) return { kind: 'rejected' };
    const startedIn = generation;
    try {
      const result = await withTimeout(
        (signal) => publicApi.POST('/auth/refresh', { body: { refreshToken: token }, signal }),
        REFRESH_TIMEOUT_MS,
      );
      // Timed out: like a network error, the credentials stay. If the API did rotate, the
      // old token still works for 10 s and is read as reuse after that (fails closed).
      if (result === TIMED_OUT || startedIn !== generation) return { kind: 'unavailable' };
      const { data, response } = result;
      if (data) {
        // Grace window: no refreshToken in the response, the stored one stays (ADR 0004 §2).
        await saveTokens(data);
        return { kind: 'ok', accessToken: data.accessToken };
      }
      if (isTransient(response.status)) return { kind: 'unavailable' };
      await clearLocal({ status: 'signedOut', notice: 'sessionEnded' });
      return { kind: 'rejected' };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  /** One refresh per process at a time: a second concurrent caller would present a rotated token (reuse). */
  function refreshOnce(): Promise<RefreshOutcome> {
    if (!inflightRefresh) {
      const flight = callRefresh().finally(() => {
        if (inflightRefresh === flight) inflightRefresh = null;
      });
      inflightRefresh = flight;
    }
    return inflightRefresh;
  }

  async function refresh(): Promise<string | null> {
    const startedIn = generation;
    const outcome = await refreshOnce();
    return outcome.kind === 'ok' && startedIn === generation ? outcome.accessToken : null;
  }

  async function accessToken(): Promise<string | null> {
    if (access && access.expiresAt - now() > EXPIRY_MARGIN_MS) return access.token;
    return refresh();
  }

  async function authFetch(request: Request): Promise<Response> {
    const route = `${request.method} ${request.url.slice(deps.baseUrl.length).split('?')[0]}`;
    if (state.status === 'mustChangePassword' && !ALLOWED_WHILE_PENDING.has(route)) {
      throw new PasswordChangeRequiredError();
    }
    const retry = request.clone();
    const token = await accessToken();
    if (!token) return new Response(null, { status: 401 });

    const response = await deps.fetch(withBearer(request, token));
    if (response.status === 403 && (await errorCode(response)) === 'PASSWORD_CHANGE_REQUIRED') {
      setState({ status: 'mustChangePassword', me: currentMe() });
      return response;
    }
    if (response.status !== 401) return response;

    const startedIn = generation;
    const fresh = await refresh();
    if (!fresh) return response;
    const retried = await deps.fetch(withBearer(retry, fresh));
    // A new token was still refused: the session is gone server side (e.g. device revoked).
    if (retried.status === 401 && startedIn === generation) await clearLocal({ status: 'signedOut', notice: 'sessionEnded' });
    return retried;
  }

  const api = createClient<paths>({ baseUrl: deps.baseUrl, fetch: authFetch });

  /** Loads `GET /me` and derives the state; keeps the current one on network errors. */
  async function loadMe(): Promise<void> {
    const startedIn = generation;
    try {
      const { data } = await api.GET('/me');
      // The session changed meanwhile (logout, new login): this answer belongs to the old one.
      if (startedIn !== generation) return;
      if (data) {
        setState(data.user.mustChangePassword ? { status: 'mustChangePassword', me: data } : { status: 'signedIn', me: data });
        return;
      }
    } catch {
      // Offline: fall through.
    }
    if (startedIn === generation && state.status === 'loading') setState({ status: 'unreachable' });
  }

  async function restore(): Promise<void> {
    if (!(await storedRefreshToken())) {
      setState({ status: 'signedOut' });
      return;
    }
    if (state.status !== 'unreachable') setState({ status: 'loading' });
    const token = await refresh();
    if (token) await loadMe();
    else if (state.status === 'loading') setState({ status: 'unreachable' });
  }

  async function login(email: string, password: string): Promise<LoginResult> {
    const deviceId = await storage.get(DEVICE_ID_KEY);
    try {
      const { data, response } = await publicApi.POST('/auth/login', {
        body: {
          email,
          password,
          ...(deviceId ? { deviceId } : {}),
          device: { label: `${PLATFORM_LABEL[deps.platform]} · Monaco`, platform: deps.platform },
        },
      });
      if (!data) {
        if (response.status === 429) return { ok: false, reason: 'rateLimited' };
        return { ok: false, reason: isTransient(response.status) ? 'unavailable' : 'invalidCredentials' };
      }
      generation++;
      inflightRefresh = null;
      await saveTokens(data);
      // A pending change is enforced from the login response itself, before `GET /me` answers.
      setState(data.mustChangePassword ? { status: 'mustChangePassword', me: null } : { status: 'loading' });
      await loadMe();
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
    try {
      const { data, error, response } = await api.POST('/auth/password', { body: { currentPassword, newPassword } });
      if (!data) {
        if (response.status === 429) return { ok: false, reason: 'rateLimited' };
        if (isTransient(response.status) || response.status === 401) return { ok: false, reason: 'unavailable' };
        return { ok: false, reason: error?.error.code === 'INVALID_CURRENT_PASSWORD' ? 'invalidCurrentPassword' : 'invalidNewPassword' };
      }
      // The API rotated this device's family: the old refresh token is dead.
      generation++;
      inflightRefresh = null;
      await saveTokens(data);
      await loadMe();
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  async function logout(): Promise<void> {
    try {
      await withTimeout((signal) => api.POST('/auth/logout', { signal }).catch(() => undefined), logoutTimeoutMs);
    } finally {
      await clearLocal({ status: 'signedOut' });
    }
  }

  async function revalidate(): Promise<void> {
    if (state.status === 'unreachable') return restore();
    if (state.status === 'signedIn' || state.status === 'mustChangePassword') await loadMe();
  }

  return {
    api,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    login,
    changePassword,
    logout,
    revalidate,
    refresh,
  };
}
