import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { dashboardHref, PERIOD_LABELS, PRESETS, type DashboardFilters as Filters } from '@/lib/reports/filters';
import { cn } from '@/lib/utils';

export interface FilterLocation {
  id: string;
  name: string;
  archivedAt: string | null;
}

const INPUT = 'h-9 rounded-md border bg-background px-3 text-sm';
const Hidden = ({ name, value }: { name: string; value: string | undefined }) => (value ? <input type="hidden" name={name} value={value} /> : null);

/**
 * Filters as plain links and GET forms: the URL is the state (a link reproduces the view), no client JS.
 * The presets are ≤30 days (reports budget, ADR 0007); a custom range is validated by the API.
 */
export function DashboardFilters({ filters, locations }: { filters: Filters; locations: readonly FilterLocation[] }) {
  const range = filters.period === 'rango';
  return (
    <div className="flex flex-wrap items-end gap-4" aria-label="Filtros del tablero" role="group">
      <nav aria-label="Período" className="flex gap-1">
        {PRESETS.map((preset) => {
          const active = filters.period === preset;
          return (
            <Link
              key={preset}
              href={dashboardHref(filters, { period: preset, from: undefined, to: undefined })}
              aria-current={active ? 'page' : undefined}
              className={cn('rounded-md border px-3 py-1.5 text-sm', active ? 'bg-foreground text-background' : 'hover:bg-muted')}
            >
              {PERIOD_LABELS[preset]}
            </Link>
          );
        })}
      </nav>

      <form method="get" action="/tablero" className="flex items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="dashboard-location" className="text-sm font-medium">
            Punto de venta
          </label>
          <select id="dashboard-location" name="punto" defaultValue={filters.locationId ?? ''} className={cn(INPUT, 'w-52')}>
            <option value="">Todos mis puntos</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.archivedAt ? `${l.name} (archivado)` : l.name}
              </option>
            ))}
          </select>
        </div>
        <Hidden name="periodo" value={range || filters.period === 'hoy' ? undefined : filters.period} />
        <Hidden name="desde" value={range ? filters.from : undefined} />
        <Hidden name="hasta" value={range ? filters.to : undefined} />
        <Hidden name="moneda" value={filters.currency} />
        <Hidden name="orden" value={filters.order === 'revenue' ? undefined : filters.order} />
        <Button type="submit" size="sm" variant="outline">
          Aplicar
        </Button>
      </form>

      <form method="get" action="/tablero" className="flex items-end gap-2" aria-label="Rango de fechas">
        <div className="space-y-1">
          <label htmlFor="dashboard-from" className="text-sm font-medium">
            Desde
          </label>
          <input id="dashboard-from" type="date" name="desde" required defaultValue={range ? filters.from : undefined} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label htmlFor="dashboard-to" className="text-sm font-medium">
            Hasta
          </label>
          <input id="dashboard-to" type="date" name="hasta" required defaultValue={range ? filters.to : undefined} className={INPUT} />
        </div>
        <Hidden name="punto" value={filters.locationId} />
        <Hidden name="moneda" value={filters.currency} />
        <Hidden name="orden" value={filters.order === 'revenue' ? undefined : filters.order} />
        <Button type="submit" size="sm" variant={range ? 'default' : 'outline'}>
          Ver rango
        </Button>
      </form>
    </div>
  );
}
