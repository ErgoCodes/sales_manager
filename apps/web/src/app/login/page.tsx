import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function LoginPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <p className="text-sm opacity-70">Próximamente: la autenticación llega en SP2.</p>
    </div>
  );
}
