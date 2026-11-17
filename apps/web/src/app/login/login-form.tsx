'use client';

import { useActionState } from 'react';
import { loginAction, type FormState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="w-full max-w-sm space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Correo electrónico
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="w-full rounded-md border bg-background px-3 py-2" />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Contraseña
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="w-full rounded-md border bg-background px-3 py-2" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-60">
        {pending ? 'Ingresando…' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
