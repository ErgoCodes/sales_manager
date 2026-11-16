import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <LoginForm />
    </main>
  );
}
