import { ErrorNotice } from '@/components/admin/page-state';

/** One dashboard card: its own heading, and its own loading, empty and error states (spec SP4). */
export function DashboardCard({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function CardLoading({ title }: { title: string }) {
  return (
    <DashboardCard title={title}>
      <p role="status" className="text-sm opacity-70">
        Cargando…
      </p>
    </DashboardCard>
  );
}

export function CardEmpty({ message = 'No hay ventas en este período.' }: { message?: string }) {
  return <p className="text-sm opacity-70">{message}</p>;
}

export function CardError({ message }: { message: string }) {
  return <ErrorNotice message={message} />;
}
