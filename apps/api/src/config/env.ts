import { z } from 'zod';

const LogLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

function isBareOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * Exact origins (scheme + host + optional port) allowed by CORS. A wildcard is
 * rejected on purpose: credentials will travel with requests from SP2 on.
 */
const CorsOrigins = z
  .string()
  .min(1)
  .transform((raw) => raw.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(
    z
      .array(
        z
          .url({ protocol: /^https?$/ })
          .refine(isBareOrigin, {
            message: 'Must be a bare origin like https://app.example.com (no path or trailing slash)',
          }),
      )
      .min(1),
  );

const base64url = (length: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));

const Ed25519PublicJwk = z.strictObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: base64url(43),
  kid: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  alg: z.literal('EdDSA').optional(),
  use: z.literal('sig').optional(),
});
const Ed25519PrivateJwk = Ed25519PublicJwk.extend({ d: base64url(43) });

export type Ed25519PublicJwk = z.infer<typeof Ed25519PublicJwk>;
export type Ed25519PrivateJwk = z.infer<typeof Ed25519PrivateJwk>;

/** A JWK in an env var: one-line JSON (`pnpm --filter api keys:generate` prints it). */
const jsonJwk = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Must be a JWK as one-line JSON (run `pnpm --filter api keys:generate`)' });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  CORS_ORIGINS: CorsOrigins,
  LOG_LEVEL: LogLevel.default('info'),
  APP_VERSION: z.string().min(1).default('0.1.0'),
  /**
   * Ed25519 signing key of the access tokens (private JWK with `kid`). It only
   * lives in the API, never in the web app (ADR 0004).
   */
  JWT_PRIVATE_JWK: jsonJwk(Ed25519PrivateJwk),
  /** Public half of the previous key, still accepted while its tokens expire (rotation). */
  JWT_PREVIOUS_PUBLIC_JWK: jsonJwk(Ed25519PublicJwk).optional(),
  JWT_ISSUER: z.string().min(1).default('monaco-api'),
  JWT_AUDIENCE: z.string().min(1).default('monaco'),
  /**
   * Shared with the web BFF, which signs the client IP it forwards (ADR 0004).
   * Without it the signed header is always ignored; required in production.
   */
  CLIENT_IP_HMAC_SECRET: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(32).optional()),
})
  .refine((env) => env.NODE_ENV !== 'production' || env.CLIENT_IP_HMAC_SECRET !== undefined, {
    path: ['CLIENT_IP_HMAC_SECRET'],
    message: 'Required in production',
  })
  .refine((env) => env.JWT_PREVIOUS_PUBLIC_JWK?.kid !== env.JWT_PRIVATE_JWK.kid, {
    path: ['JWT_PREVIOUS_PUBLIC_JWK'],
    message: 'kid must differ from the current key',
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Parses and validates the environment once at startup (fail-fast). Error
 * messages name the variable but never echo its value, which may be a secret.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
