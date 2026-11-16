'use client';

import { useActionState } from 'react';
import type { FormState } from '../login/actions';
import { changePasswordAction } from './actions';

const input = 'w-full rounded-md border bg-background px-3 py-2';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="w-full max-w-sm space-y-4">
      <div className="space-y-1">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          Contraseña actual
        </label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="newPassword" className="text-sm font-medium">
          Nueva contraseña
        </label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required className={input} />
        <p className="text-xs opacity-70">Mínimo 12 caracteres.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          Confirma la nueva contraseña
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={input} />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-60">
        {pending ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}
