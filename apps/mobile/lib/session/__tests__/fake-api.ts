/** Test doubles for the session tests: an in-memory `expo-secure-store` and a scripted API. */

export const secureStoreData = new Map<string, string>();

export const secureStoreMock = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async (key: string) => secureStoreData.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStoreData.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    secureStoreData.delete(key);
  }),
};

export function resetSecureStore() {
  secureStoreData.clear();
  secureStoreMock.getItemAsync.mockClear();
  secureStoreMock.setItemAsync.mockClear();
  secureStoreMock.deleteItemAsync.mockClear();
}

export const BASE_URL = 'https://api.test';
export const DEVICE_ID = '0190a000-0000-7000-8000-000000000001';
export const OTHER_DEVICE_ID = '0190a000-0000-7000-8000-000000000002';

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

export function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
}

export function me(overrides: { mustChangePassword?: boolean } = {}) {
  return {
    user: {
      id: '0190a000-0000-7000-8000-0000000000aa',
      email: 'owner@demo.test',
      displayName: 'Owner Demo',
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
    tenant: { id: '0190a000-0000-7000-8000-0000000000bb', name: 'Mercado Demo', slug: 'demo' },
    deviceId: DEVICE_ID,
    permissions: [],
  };
}

export function tokens(n: number, overrides: { mustChangePassword?: boolean; deviceId?: string } = {}) {
  return {
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}`,
    expiresIn: 600,
    deviceId: overrides.deviceId ?? DEVICE_ID,
    mustChangePassword: overrides.mustChangePassword ?? false,
  };
}

/**
 * Scripted fetch: each `METHOD /path` has a queue of replies; the last one repeats.
 * A missing route fails the test loudly.
 */
export function createFakeApi() {
  const routes = new Map<string, Reply[]>();
  const calls: RecordedCall[] = [];

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = await request.text();
    const call: RecordedCall = {
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get('Authorization'),
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const queue = routes.get(key);
    if (!queue || queue.length === 0) throw new Error(`Unexpected request ${key}`);
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(call) : reply.clone();
  }

  return {
    fetch: jest.fn(fetch),
    calls,
    on(key: string, ...replies: Reply[]) {
      routes.set(key, replies);
    },
    callsTo(key: string) {
      return calls.filter((c) => `${c.method} ${c.path}` === key);
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
