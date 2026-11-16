import { NextResponse, type NextRequest } from 'next/server';
import { createAuthenticatedClient } from '@/lib/api/authenticated';
import { allowedOrigins, parseServerEnv } from '@/lib/env';
import { isAllowedOrigin } from '@/lib/security/origin';
import { clearSession, getSession } from '@/lib/session/server';
import { cookies } from 'next/headers';

/** POST only: no GET may change state. Cross-site POSTs are refused (see lib/security/origin.ts). */
export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request, allowedOrigins(parseServerEnv()))) {
    return new NextResponse('Origen no permitido', { status: 403 });
  }
  try {
    if ((await getSession()).accessToken) {
      const api = await createAuthenticatedClient({ canRefresh: false });
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
