import type { Metadata } from 'next';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Cambiar contraseña' };

export default function ChangePasswordPage() {
  return (
    <main className="mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Cambiar contraseña</h1>
      <p className="text-sm opacity-70">Debes elegir una contraseña nueva antes de continuar.</p>
      <ChangePasswordForm />
    </main>
  );
}
