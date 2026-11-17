import type { Metadata } from 'next';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Cambiar contraseña' };

export default function ChangePasswordPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cambiar contraseña</h1>
      <p className="text-sm opacity-70">Debes elegir una contraseña nueva antes de continuar.</p>
      <ChangePasswordForm />
    </div>
  );
}
