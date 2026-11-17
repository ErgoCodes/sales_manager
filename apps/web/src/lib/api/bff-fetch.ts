import 'server-only';
import { CLIENT_IP_HEADER, signClientIp } from '@/lib/security/client-ip';

export interface BffFetchOptions {
  /** CLIENT_IP_HMAC_SECRET. Without it (or without an IP) the signed header is omitted. */
  secret: string | undefined;
  ip: string | null;
  accessToken?: string;
  /** Returns a fresh access token, or null when the session is over. Absent in Server Components (they cannot write cookies). */
  refresh?: () => Promise<string | null>;
  baseFetch?: typeof fetch;
  now?: () => number;
}

/**
 * `fetch` for the typed API client: adds the bearer and the signed client-IP header,
 * and on a 401 refreshes once and retries once.
 */
export function createBffFetch(options: BffFetchOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? fetch;
  const now = options.now ?? Date.now;

  const send = (request: Request, token: string | undefined): Promise<Response> => {
    if (token) request.headers.set('authorization', `Bearer ${token}`);
    if (options.secret && options.ip) {
      request.headers.set(
        CLIENT_IP_HEADER,
        signClientIp({
          secret: options.secret,
          ip: options.ip,
          method: request.method,
          path: new URL(request.url).pathname,
          timestamp: Math.floor(now() / 1000),
        }),
      );
    }
    return baseFetch(request);
  };

  return async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const retry = options.refresh ? request.clone() : null; // clone before the body is consumed
    const response = await send(request, options.accessToken);
    if (response.status !== 401 || !options.refresh || !retry) return response;
    const token = await options.refresh();
    if (!token) return response;
    return send(retry, token);
  };
}
