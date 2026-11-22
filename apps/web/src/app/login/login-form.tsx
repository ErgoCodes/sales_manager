'use client';

import { useActionState, useRef } from 'react';
import type { DemoAccount } from '@/lib/demo';
import { loginAction, type FormState } from './actions';

/** `demoAccounts` (DEMO_MODE only): buttons that fill the form; the visitor still submits it (no auto-login). */
export function LoginForm({ demoAccounts = [] }: { demoAccounts?: readonly DemoAccount[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const fill = (account: DemoAccount) => {
    if (email.current) email.current.value = account.email;
    if (password.current) password.current.value = account.password;
  };
  return (
    <div className="w-full max-w-sm space-y-6">
      {demoAccounts.length > 0 ? (
        <section aria-labelledby="demo-accounts" className="space-y-2 rounded-md border p-3">
          <h2 id="demo-accounts" className="text-sm font-semibold">
            Cuentas de la demo
          </h2>
          <p className="text-sm opacity-80">Demo de solo lectura: elige una cuenta para completar el formulario y luego inicia sesión.</p>
          <div className="flex flex-wrap gap-2">
            {demoAccounts.map((account) => (
              <button key={account.email} type="button" onClick={() => fill(account)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                {account.label}
                <span className="sr-only"> ({account.email})</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <form action={action} className="w-full space-y-4">
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo electrónico
          </label>
          <input ref={email} id="email" name="email" type="email" autoComplete="username" required className="w-full rounded-md border bg-background px-3 py-2" />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <input ref={password} id="password" name="password" type="password" autoComplete="current-password" required className="w-full rounded-md border bg-background px-3 py-2" />
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
    </div>
  );
}
