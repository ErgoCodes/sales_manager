import type { HealthResult } from '@/lib/api/health';
import { cn } from '@/lib/utils';

export function HealthStatus({ result }: { result: HealthResult }) {
  if (!result.ok) {
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
        <p className="font-medium">No se pudo consultar la API</p>
        <p className="text-sm">
          {result.reason === 'unreachable'
            ? 'El servidor no responde. Verifica que la API esté en ejecución e inténtalo de nuevo.'
            : 'La API respondió con un error inesperado.'}
        </p>
      </div>
    );
  }

  const { status, db, version } = result.health;
  const healthy = status === 'ok' && db === 'up';
  return (
    <div
      role="status"
      className={cn(
        'rounded-lg border p-4',
        healthy
          ? 'border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
      )}
    >
      <p className="font-medium">
        API: {status} · DB: {db}
      </p>
      <p className="text-sm">Versión {version}</p>
    </div>
  );
}
