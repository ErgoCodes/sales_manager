'use server';

import type { ActionState } from '@/lib/action-state';
import { requestInit } from '@/lib/api/admin';
import { parseId } from '@/lib/admin/form-ids';
import { parseRoleForm } from '@/lib/admin/roles-form';
import { runMutation, text } from '@/lib/admin/run-mutation';

const PATH = ['/roles'];
const BAD_ID = { error: 'El registro indicado no es válido.' };

export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseRoleForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  return runMutation((api) => api.POST('/roles', { body: parsed.body, ...requestInit() }), PATH);
}

export async function updateRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  const parsed = parseRoleForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  return runMutation((api) => api.PATCH('/roles/{id}', { params: { path: { id } }, body: parsed.body, ...requestInit() }), PATH);
}

export async function deleteRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  return runMutation((api) => api.DELETE('/roles/{id}', { params: { path: { id } }, ...requestInit() }), PATH);
}
