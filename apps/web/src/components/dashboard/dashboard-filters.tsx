import { Button } from '@/components/ui/button';
import { SegmentedLinks } from '@/components/ui/segmented-links';
import { dashboardHref, PERIOD_LABELS, PRESETS, type DashboardFilters as Filters } from '@/lib/reports/filters';
import { cn } from '@/lib/utils';

export interface FilterLocation {
  id: string;
  name: string;
  archivedAt: string | null;
}

const FIELD =
  'h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';
const LABEL = 'text-xs font-medium text-muted-foreground';
const Hidden = ({ name, value }: { name: string; value: string | undefined }) => (value ? <input type="hidden" name={name} value={value} /> : null);

/**
 * Filters as plain links and GET forms: the URL is the state (a link reproduces the view), no client JS.
 * The presets are ≤30 days (reports budget, ADR 0007); a custom range is validated by the API.
 */
export function DashboardFilters({ filters, locations }: { filters: Filters; locations: readonly FilterLocation[] }) {
  const range = filters.period === 'rango';
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border bg-card p-3 shadow-xs" aria-label="Filtros del tablero" role="group">
      <div className="space-y-1">
        <p aria-hidden className={LABEL}>
          Período
        </p>
        <SegmentedLinks
          label="Período"
          items={PRESETS.map((preset) => ({
            key: preset,
            href: dashboardHref(filters, { period: preset, from: undefined, to: undefined }),
            label: PERIOD_LABELS[preset],
            active: filters.period === preset,
          }))}
        />
      </div>

      <form method="get" action="/tablero" className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="dashboard-location" className={LABEL}>
            Punto de venta
          </label>
          <select id="dashboard-location" name="punto" defaultValue={filters.locationId ?? ''} className={cn(FIELD, 'w-52')}>
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

      <form method="get" action="/tablero" className="flex flex-wrap items-end gap-2" aria-label="Rango de fechas">
        <div className="flex flex-col gap-1">
          <label htmlFor="dashboard-from" className={LABEL}>
            Desde
          </label>
          <input id="dashboard-from" type="date" name="desde" required defaultValue={range ? filters.from : undefined} className={FIELD} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dashboard-to" className={LABEL}>
            Hasta
          </label>
          <input id="dashboard-to" type="date" name="hasta" required defaultValue={range ? filters.to : undefined} className={FIELD} />
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
