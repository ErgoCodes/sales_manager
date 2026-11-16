'use server';

import type { ActionState } from '@/lib/action-state';
import { requestInit } from '@/lib/api/admin';
import { parseId } from '@/lib/admin/form-ids';
import { runMutation, text } from '@/lib/admin/run-mutation';

export async function revokeDeviceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return { error: 'El registro indicado no es válido.' };
  return runMutation((api) => api.POST('/devices/{id}/revoke', { params: { path: { id } }, ...requestInit() }), ['/dispositivos']);
}
