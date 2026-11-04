import 'server-only';
import createClient from 'openapi-fetch';
import { parseServerEnv } from '@/lib/env';
import type { paths } from './schema';

/** Typed API client (types generated from packages/contracts/openapi.json). Server-side only. */
export function createApiClient(baseUrl: string = parseServerEnv().API_URL) {
  return createClient<paths>({ baseUrl });
}
