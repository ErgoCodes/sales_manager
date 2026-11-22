import type { Metadata } from 'next';
import { demoAccounts } from '@/lib/demo';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesión' };

// Rendered per request (the root layout awaits connection()), so DEMO_MODE is read at runtime, not at build.
export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <LoginForm demoAccounts={demoAccounts()} />
    </main>
  );
}
