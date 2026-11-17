const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** "https://a.com/, nope" -> ["https://a.com"]: normalized origins, invalid entries dropped. */
export function parseOrigins(value: string): string[] {
  const origins: string[] = [];
  for (const raw of value.split(',')) {
    try {
      const url = new URL(raw.trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.push(url.origin);
    } catch {
      // ignore entries that are not URLs
    }
  }
  return origins;
}

/**
 * CSRF guard for Route Handlers that change something (SameSite=Lax alone does
 * not cover cross-site POSTs to them). Safe methods pass: no GET may change state.
 * Otherwise: `Sec-Fetch-Site` must not say cross-site/same-site, `Origin` (when
 * present) must be allow-listed, and one of the two must be present.
 */
export function isAllowedOrigin(request: { method: string; headers: Headers }, allowed: readonly string[]): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (origin !== null) return allowed.includes(origin);
  return site !== null;
}
