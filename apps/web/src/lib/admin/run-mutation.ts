import 'server-only';
import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/lib/action-state';
import { callApi } from '@/lib/api/admin';

type CallApi<T> = Parameters<typeof callApi<T>>[0];

/**
 * Runs a mutation from a Server Action (cookies writable, so a 401 refreshes once),
 * revalidates the affected pages and returns the state the dialog renders.
 */
export async function runMutation<T>(call: CallApi<T>, revalidate: readonly string[], onOk?: (data: T) => Partial<ActionState>): Promise<ActionState> {
  const result = await callApi(call, { canRefresh: true });
  if (!result.ok) return { error: result.message };
  for (const path of revalidate) revalidatePath(path);
  return { done: true, ...onOk?.(result.data) };
}

export function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
