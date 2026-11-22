import type { Metadata } from 'next';
import { Store } from 'lucide-react';
import { demoAccounts } from '@/lib/demo';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesión' };

// Rendered per request (the root layout awaits connection()), so DEMO_MODE is read at runtime, not at build.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
            <p className="text-sm text-muted-foreground">Back-office de Mercado Mónaco</p>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <LoginForm demoAccounts={demoAccounts()} />
        </div>
      </div>
    </main>
  );
}
