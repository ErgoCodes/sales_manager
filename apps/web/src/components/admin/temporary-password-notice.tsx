const formatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** One-time display of a temporary password. Never stored client-side nor logged. */
export function TemporaryPasswordNotice({ email, password, expiresAt }: { email?: string; password: string; expiresAt: string }) {
  return (
    <div role="status" className="space-y-2 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">Contraseña temporal{email ? ` para ${email}` : ''}</p>
      <p>
        <code data-testid="temporary-password" className="select-all rounded bg-white px-2 py-1 font-mono text-base">
          {password}
        </code>
      </p>
      <p>Se muestra una sola vez: cópiala ahora y entrégala por un canal seguro. Vence el {formatter.format(new Date(expiresAt))} (UTC).</p>
      <p>La persona deberá cambiarla al iniciar sesión.</p>
    </div>
  );
}
