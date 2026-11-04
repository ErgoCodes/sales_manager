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

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  CORS_ORIGINS: CorsOrigins,
  LOG_LEVEL: LogLevel.default('info'),
  APP_VERSION: z.string().min(1).default('0.1.0'),
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
