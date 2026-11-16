'use server';

import { CreateLocationRequest, UpdateLocationRequest } from '@monaco/contracts';
import type { ActionState } from '@/lib/action-state';
import { requestInit } from '@/lib/api/admin';
import { parseId } from '@/lib/admin/form-ids';
import { runMutation, text } from '@/lib/admin/run-mutation';

const PATH = ['/puntos-de-venta'];
const INVALID = { error: 'Revisa el nombre y el código (letras, números, "-" y "_", máximo 32).' };
const BAD_ID = { error: 'El registro indicado no es válido.' };

export async function createLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const body = CreateLocationRequest.safeParse({ name: text(formData, 'name'), code: text(formData, 'code') });
  if (!body.success) return INVALID;
  return runMutation((api) => api.POST('/locations', { body: body.data, ...requestInit() }), PATH);
}

export async function updateLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  const body = UpdateLocationRequest.safeParse({ name: text(formData, 'name'), code: text(formData, 'code') });
  if (!body.success) return INVALID;
  return runMutation((api) => api.PATCH('/locations/{id}', { params: { path: { id } }, body: body.data, ...requestInit() }), PATH);
}

export async function archiveLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseId(text(formData, 'id'));
  if (!id) return BAD_ID;
  return runMutation((api) => api.POST('/locations/{id}/archive', { params: { path: { id } }, ...requestInit() }), PATH);
}
