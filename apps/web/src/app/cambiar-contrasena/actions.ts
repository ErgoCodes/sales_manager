'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { describeApiError, errorCode } from '@/lib/api-errors';
import { createAuthenticatedClient } from '@/lib/api/authenticated';
import { applyTokens } from '@/lib/session/server';
import type { FormState } from '../login/actions';

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const currentPassword = formData.get('currentPassword');
  const newPassword = formData.get('newPassword');
  const confirm = formData.get('confirmPassword');
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return { error: 'Completa todos los campos.' };
  }
  if (newPassword !== confirm) return { error: 'La confirmación no coincide con la nueva contraseña.' };
  if (newPassword.length < 12) return { error: 'La nueva contraseña debe tener al menos 12 caracteres.' };
  if (newPassword === currentPassword) return { error: 'La nueva contraseña debe ser distinta de la actual.' };

  const api = await createAuthenticatedClient({ canRefresh: true });
  let result;
  try {
    result = await api.POST('/auth/password', {
      body: { currentPassword, newPassword },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
  } catch {
    return { error: 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos minutos.' };
  }

  const { data, response } = result;
  if (!data) {
    if (response.status === 401) redirect('/login');
    if (response.status === 429) return { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' };
    if (response.status >= 500) return { error: 'El servicio no está disponible. Inténtalo de nuevo en unos minutos.' };
    const code = errorCode(result.error);
    if (code === 'DEMO_READ_ONLY') return { error: describeApiError(response.status, code) };
    return { error: 'No se pudo cambiar la contraseña. Revisa los datos e inténtalo de nuevo.' };
  }

  // The API rotated this device's session family: store the new pair.
  applyTokens(await cookies(), data);
  redirect('/');
}
