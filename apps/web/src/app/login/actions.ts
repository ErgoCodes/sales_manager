'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAnonymousClient } from '@/lib/api/authenticated';
import { applyTokens, clearSession, getSession } from '@/lib/session/server';
import { cookies } from 'next/headers';

export interface FormState {
  error?: string;
}

const GENERIC_ERROR = 'No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.';

function deviceLabel(userAgent: string | null): string {
  return (userAgent?.trim() || 'Navegador web').slice(0, 100);
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = formData.get('email');
  const password = formData.get('password');
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return { error: 'Ingresa tu correo y tu contraseña.' };
  }

  const { deviceId } = await getSession();
  const api = await createAnonymousClient();
  let result;
  try {
    result = await api.POST('/auth/login', {
      body: {
        email: email.trim(),
        password,
        deviceId,
        device: { label: deviceLabel((await headers()).get('user-agent')), platform: 'web' },
      },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
  } catch {
    return { error: 'No pudimos conectar con el servidor. Inténtalo de nuevo en unos minutos.' };
  }

  const { data, response } = result;
  if (!data) {
    if (response.status === 429) return { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' };
    return { error: response.status >= 500 ? 'El servicio no está disponible. Inténtalo de nuevo en unos minutos.' : GENERIC_ERROR };
  }

  // Anti-fixation: whatever session cookies the browser held are discarded before the new ones are issued.
  const jar = await cookies();
  clearSession(jar);
  applyTokens(jar, data);
  redirect(data.mustChangePassword ? '/cambiar-contrasena' : '/');
}
