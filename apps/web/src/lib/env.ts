import 'server-only';
import { z } from 'zod';
import { parseOrigins } from '@/lib/security/origin';

const serverEnvSchema = z
  .object({
    // Base URL of apps/api. Server-side only: never exposed with NEXT_PUBLIC_.
    API_URL: z.url({ protocol: /^https?$/ }),
    // Shared with the API (CLIENT_IP_HMAC_SECRET): signs the client IP header (ADR 0004 §7).
    CLIENT_IP_HMAC_SECRET: z.string().min(32).optional(),
    // Comma-separated origins this app is served from (CSRF allow-list, serverActions.allowedOrigins).
    APP_ORIGINS: z.string().optional(),
    // Trusted reverse proxies in front of this app; picks the x-forwarded-for hop (see clientIpFromHeaders). Default 0 = trust none.
    TRUSTED_PROXY_HOPS: z.string().regex(/^\d{1,2}$/).optional(),
    NODE_ENV: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.CLIENT_IP_HMAC_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['CLIENT_IP_HMAC_SECRET'], message: 'required in production (min 32 chars)' });
    }
    if (parseOrigins(env.APP_ORIGINS ?? '').length === 0) {
      ctx.addIssue({ code: 'custom', path: ['APP_ORIGINS'], message: 'required in production (e.g. https://app.example.com)' });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parses the given env (defaults to process.env). Throws a readable error when invalid. */
export function parseServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment: ${issues}`);
  }
  return result.data;
}

/** Origins allowed to submit state-changing requests. Dev defaults to the local app. */
export function allowedOrigins(env: ServerEnv): string[] {
  return parseOrigins(env.APP_ORIGINS ?? 'http://localhost:3000');
}

/** Number of trusted proxies in front of the app (0 when unset: no forwarded header is trusted). */
export function trustedProxyHops(env: ServerEnv): number {
  return env.TRUSTED_PROXY_HOPS === undefined ? 0 : Number(env.TRUSTED_PROXY_HOPS);
}
