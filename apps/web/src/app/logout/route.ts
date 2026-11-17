import { NextResponse, type NextRequest } from 'next/server';
import { createAuthenticatedClient } from '@/lib/api/authenticated';
import { allowedOrigins, parseServerEnv } from '@/lib/env';
import { isAllowedOrigin } from '@/lib/security/origin';
import { clearSession, getSession, refreshSessionCookies } from '@/lib/session/server';
import { cookies } from 'next/headers';

/** POST only: no GET may change state. Cross-site POSTs are refused (see lib/security/origin.ts). */
export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request, allowedOrigins(parseServerEnv()))) {
    return new NextResponse('Origen no permitido', { status: 403 });
  }
  try {
    const { accessToken, refreshToken } = await getSession();
    // The access cookie expires before the refresh one: after idling, only the refresh cookie is left.
    // Refresh first so the session family can still be revoked server-side.
    const token = accessToken ?? (refreshToken ? await refreshSessionCookies() : null);
    if (token) {
      const api = await createAuthenticatedClient({ canRefresh: true, accessToken: token });
      await api.POST('/auth/logout', { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    }
  } catch {
    // The API being down must not keep the user signed in on this browser.
  } finally {
    clearSession(await cookies());
  }
  // The Origin (if any) was allow-listed above; request.url may carry an internal host behind a proxy.
  return NextResponse.redirect(new URL('/login', request.headers.get('origin') ?? request.url), 303);
}
