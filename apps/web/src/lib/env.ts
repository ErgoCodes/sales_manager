import 'server-only';
import { z } from 'zod';

const serverEnvSchema = z.object({
  // Base URL of apps/api. Server-side only: never exposed with NEXT_PUBLIC_.
  API_URL: z.url({ protocol: /^https?$/ }),
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
