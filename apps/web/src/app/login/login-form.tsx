'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
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
  const [showPassword, setShowPassword] = useState(false);
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
          <div className="relative">
            <Input ref={password} id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required className="pr-10" />
            {/* The name avoids "contraseña" so the field's label stays unique (e2e selects it by substring). */}
            <button
              type="button"
              aria-label="Mostrar caracteres"
              aria-controls="password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>
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
