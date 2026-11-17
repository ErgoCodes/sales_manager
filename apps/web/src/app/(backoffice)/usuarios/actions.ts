'use server';

import { CreateUserRequest } from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { callApi, requestInit } from '@/lib/api/admin';
import { parseId } from '@/lib/admin/form-ids';
import { runMutation, text } from '@/lib/admin/run-mutation';

const PATH = ['/usuarios'];
const BAD_ID = { error: 'El registro indicado no es válido.' };

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const body = CreateUserRequest.safeParse({ email: text(formData, 'email'), displayName: text(formData, 'displayName') });
  if (!body.success) return { error: 'Revisa el correo electrónico y el nombre (máximo 100 caracteres).' };
  return runMutation(
    (api) => api.POST('/users', { body: body.data, ...requestInit() }),
    PATH,
    (data) => ({ temporaryPassword: { value: data.temporaryPassword, expiresAt: data.temporaryPasswordExpiresAt, email: body.data.email } }),
  );
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  const state = await runMutation(
    (api) => api.POST('/users/{id}/reset-password', { params: { path: { id } }, ...requestInit() }),
    PATH,
    (data) => ({ temporaryPassword: { value: data.temporaryPassword, expiresAt: data.temporaryPasswordExpiresAt } }),
  );
  if (!state.temporaryPassword) return state;
  // The label comes from the API, never from a form field the client could tamper with.
  const user = await callApi((api) => api.GET('/users/{id}', { params: { path: { id } }, ...requestInit() }), { canRefresh: true });
  if (user.ok) state.temporaryPassword.email = user.data.email;
  return state;
}

export async function disableUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  return runMutation((api) => api.POST('/users/{id}/disable', { params: { path: { id } }, ...requestInit() }), PATH);
}
