import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function LoginPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <LoginForm />
    </div>
  );
}
