'use client';

import { useActionState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
        <section aria-labelledby="demo-accounts" className="space-y-2 rounded-lg border border-dashed p-3">
          <h2 id="demo-accounts" className="text-sm font-semibold">
            Cuentas de la demo
          </h2>
          <p className="text-sm text-muted-foreground">Demo de solo lectura: elige una cuenta para completar el formulario y luego inicia sesión.</p>
          <div className="flex flex-wrap gap-2">
            {demoAccounts.map((account) => (
              <Button key={account.email} type="button" variant="outline" size="sm" onClick={() => fill(account)}>
                {account.label}
                <span className="sr-only"> ({account.email})</span>
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      <form action={action} className="w-full space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input ref={email} id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input ref={password} id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Ingresando…' : 'Iniciar sesión'}
        </Button>
      </form>
    </div>
  );
}
