import { Inbox } from 'lucide-react';
import { ErrorNotice } from '@/components/admin/page-state';

/** One dashboard card: its own heading, and its own loading, empty and error states (spec SP4). */
export function DashboardCard({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Skeleton in the card's place while its data streams in; the status text is for screen readers. */
export function CardLoading({ title }: { title: string }) {
  return (
    <DashboardCard title={title}>
      <p role="status" className="sr-only">
        Cargando…
      </p>
      <div aria-hidden className="space-y-3">
        <div className="skeleton h-4 w-1/3" />
        <div className="skeleton h-24 w-full" />
      </div>
    </DashboardCard>
  );
}

export function CardEmpty({ message = 'No hay ventas en este período.' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      <Inbox aria-hidden className="size-5" />
      <p>{message}</p>
    </div>
  );
}

export function CardError({ message }: { message: string }) {
  return <ErrorNotice message={message} />;
}
