'use server';

import { ReplaceAssignmentsRequest } from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { requestInit } from '@/lib/api/admin';
import { parseId } from '@/lib/admin/form-ids';
import { runMutation, text } from '@/lib/admin/run-mutation';

export async function replaceAssignmentsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return { error: 'El registro indicado no es válido.' };
  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, 'payload'));
  } catch {
    return { error: 'Las asignaciones enviadas no son válidas.' };
  }
  const body = ReplaceAssignmentsRequest.safeParse(payload);
  if (!body.success) return { error: 'Las asignaciones enviadas no son válidas.' };
  return runMutation((api) => api.PUT('/users/{id}/assignments', { params: { path: { id } }, body: body.data, ...requestInit() }), [`/usuarios/${id}`]);
}
