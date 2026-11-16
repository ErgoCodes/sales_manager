'use server';

import { CreateUserRequest } from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { requestInit } from '@/lib/api/admin';
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
  const email = text(formData, 'email') || undefined;
  return runMutation(
    (api) => api.POST('/users/{id}/reset-password', { params: { path: { id } }, ...requestInit() }),
    PATH,
    (data) => ({ temporaryPassword: { value: data.temporaryPassword, expiresAt: data.temporaryPasswordExpiresAt, email } }),
  );
}

export async function disableUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  return runMutation((api) => api.POST('/users/{id}/disable', { params: { path: { id } }, ...requestInit() }), PATH);
}
