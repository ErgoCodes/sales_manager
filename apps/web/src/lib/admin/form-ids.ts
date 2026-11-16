import { IdParams } from '@monaco/contracts';

/** Validates a hidden `id` form field with the shared contract (a UUID). */
export function parseId(value: string): string | null {
  const parsed = IdParams.safeParse({ id: value });
  return parsed.success ? parsed.data.id : null;
}
