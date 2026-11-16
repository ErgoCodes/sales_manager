import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, applyTokens, clearSession, readSession, type TokenSet } from '@/lib/session/cookies';
import { buildCsp } from '@/lib/security/csp';
import { clientIpFromHeaders } from '@/lib/security/client-ip';
import { refreshSession } from '@/lib/session/refresh-api';

/** Reachable without a session. `/logout` must work even when the session is already gone. */
const PUBLIC_PATHS = new Set(['/login', '/logout']);
const CHANGE_PASSWORD_PATH = '/cambiar-contrasena';

function withCsp(headers: Headers, csp: string): Headers {
  headers.set('content-security-policy', csp);
  return headers;
}

/**
 * Next 16 proxy: CSP nonce on every request, then the session gate.
 * - no session cookies -> /login
 * - no access cookie but a refresh cookie -> refresh here (the proxy can write cookies, Server Components cannot)
 * - must_change_password -> /cambiar-contrasena
 * The API is the real authority; this only saves round trips and shapes navigation.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string, clear = false) => {
    const response = NextResponse.redirect(new URL(path, request.url));
    response.headers.set('content-security-policy', csp);
    if (clear) clearSession(response.cookies);
    return response;
  };

  let rotated: TokenSet | null = null;
  let mustChange = false;

  if (!PUBLIC_PATHS.has(pathname)) {
    const session = readSession(request.cookies);
    mustChange = session.mustChangePassword;
    if (!session.accessToken) {
      if (!session.refreshToken) return redirectTo('/login');
      const result = await refreshSession(session.refreshToken, clientIpFromHeaders(request.headers));
      if (result.kind === 'rejected') return redirectTo('/login', true);
      if (result.kind === 'unavailable') {
        return new NextResponse('El servicio no está disponible. Inténtalo de nuevo en unos minutos.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '10' },
        });
      }
      rotated = result;
      // Let this same request's Server Components see the fresh access token.
      request.cookies.set(ACCESS_COOKIE, result.accessToken);
    }
    if (mustChange && pathname !== CHANGE_PASSWORD_PATH) return redirectTo(CHANGE_PASSWORD_PATH);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  withCsp(requestHeaders, csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  withCsp(response.headers, csp);
  if (rotated) applyTokens(response.cookies, rotated);
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
