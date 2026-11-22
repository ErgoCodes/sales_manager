import Link from 'next/link';
import type { CurrencyCode } from '@monaco/contracts';
import { BarChart } from '@/components/dashboard/bar-chart';
import { CardEmpty, CardError, DashboardCard } from '@/components/dashboard/card';
import { CurrencyTabs } from '@/components/dashboard/currency-tabs';
import { DailyChart } from '@/components/dashboard/daily-chart';
import { HealthPanel } from '@/components/dashboard/health-panel';
import { SummaryCards } from '@/components/dashboard/summary-cards';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatQuantity } from '@/lib/inventory/format';
import { dashboardHref, ORDER_LABELS, type DashboardFilters } from '@/lib/reports/filters';
import { formatAmount, formatMargin } from '@/lib/reports/format';
import { cn } from '@/lib/utils';
import type { DashboardData } from './data';

type Props = { data: DashboardData; filters: DashboardFilters };

/** The card's currency: the dashboard's, else the first one this card has data for. */
const pick = (chosen: CurrencyCode | undefined, available: readonly CurrencyCode[]) => chosen ?? available[0];

export const TITLES = {
  summary: 'Resumen',
  series: 'Ventas diarias',
  top: 'Productos más vendidos',
  byLocation: 'Comparativa por punto',
  health: 'Salud del inventario',
} as const;

export async function SummarySection({ data, filters }: Props) {
  const [summary, chosen] = await Promise.all([data.summary, data.currency]);
  if (!summary.ok) return <DashboardCard title={TITLES.summary}><CardError message={summary.message} /></DashboardCard>;
  const { currencies, from, to, timeZone } = summary.data;
  const totals = currencies.find((t) => t.currency === pick(chosen, []));
  return (
    <DashboardCard title={TITLES.summary} actions={<CurrencyTabs currencies={currencies.map((t) => t.currency)} selected={totals?.currency} filters={filters} />}>
      <p className="text-sm opacity-70">
        {from === to ? `Día ${from}` : `Del ${from} al ${to}`} · zona {timeZone}
      </p>
      {totals ? <SummaryCards totals={totals} /> : <CardEmpty />}
    </DashboardCard>
  );
}

export async function SeriesSection({ data }: Props) {
  const [series, chosen] = await Promise.all([data.series, data.currency]);
  if (!series.ok) return <DashboardCard title={TITLES.series}><CardError message={series.message} /></DashboardCard>;
  const currency = pick(chosen, series.data.series.map((s) => s.currency));
  const points = series.data.series.find((s) => s.currency === currency)?.points ?? [];
  return (
    <DashboardCard title={TITLES.series}>{currency && points.some((p) => p.totalSales > 0) ? <DailyChart points={points} currency={currency} /> : <CardEmpty />}</DashboardCard>
  );
}

export async function TopProductsSection({ data, filters }: Props) {
  const [top, chosen] = await Promise.all([data.top, data.currency]);
  const orders = (
    <nav aria-label="Ordenar ranking" className="flex gap-1 text-sm">
      {(Object.keys(ORDER_LABELS) as (keyof typeof ORDER_LABELS)[]).map((order) => (
        <Link key={order} href={dashboardHref(filters, { order })} aria-current={filters.order === order ? 'page' : undefined} className={cn('rounded-md border px-2 py-1', filters.order === order ? 'bg-foreground text-background' : 'hover:bg-muted')}>
          {ORDER_LABELS[order]}
        </Link>
      ))}
    </nav>
  );
  if (!top.ok) return <DashboardCard title={TITLES.top} actions={orders}><CardError message={top.message} /></DashboardCard>;
  const currency = pick(chosen, top.data.items.map((i) => i.currency));
  // The API ranks within each currency (ordered by currency, then rank): keep that order, one currency.
  const items = top.data.items.filter((i) => i.currency === currency);
  if (!currency || items.length === 0) return <DashboardCard title={TITLES.top} actions={orders}><CardEmpty /></DashboardCard>;
  const metric = (item: (typeof items)[number]) =>
    filters.order === 'quantity'
      ? { value: item.quantity, display: `${formatQuantity(item.quantity)} ${item.unitOfMeasure}` }
      : filters.order === 'profit'
        ? { value: Math.max(0, item.profit), display: formatAmount(item.profit, currency) }
        : { value: item.totalSales, display: formatAmount(item.totalSales, currency) };
  return (
    <DashboardCard title={TITLES.top} actions={orders}>
      <BarChart label={`Ranking de productos por ${ORDER_LABELS[filters.order].toLowerCase()} en ${currency}`} valueHeading={ORDER_LABELS[filters.order]} items={items.map((item) => ({ key: item.productId, label: item.name, ...metric(item) }))} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead>Cantidad</TableHead>
            <TableHead>Ventas</TableHead>
            <TableHead>Utilidad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, i) => (
            <TableRow key={item.productId}>
              <TableCell>{i + 1}</TableCell>
              <TableCell>{item.name}</TableCell>
              <TableCell>
                {formatQuantity(item.quantity)} {item.unitOfMeasure}
              </TableCell>
              <TableCell>{formatAmount(item.totalSales, currency)}</TableCell>
              <TableCell>{formatAmount(item.profit, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardCard>
  );
}

export async function ByLocationSection({ data }: Props) {
  if (!data.byLocation) {
    return (
      <DashboardCard title={TITLES.byLocation}>
        <CardEmpty message="Elige «Todos mis puntos» para comparar los puntos de venta." />
      </DashboardCard>
    );
  }
  const [byLocation, chosen] = await Promise.all([data.byLocation, data.currency]);
  if (!byLocation.ok) return <DashboardCard title={TITLES.byLocation}><CardError message={byLocation.message} /></DashboardCard>;
  const currency = pick(chosen, byLocation.data.locations.flatMap((l) => l.currencies.map((c) => c.currency)));
  const rows = byLocation.data.locations.map((l) => ({ ...l, totals: l.currencies.find((c) => c.currency === currency) }));
  if (!currency || rows.every((r) => !r.totals)) return <DashboardCard title={TITLES.byLocation}><CardEmpty /></DashboardCard>;
  return (
    <DashboardCard title={TITLES.byLocation}>
      <BarChart label={`Ventas por punto en ${currency}`} valueHeading="Ventas" items={rows.map((r) => ({ key: r.locationId, label: r.locationName, value: r.totals?.totalSales ?? 0, display: formatAmount(r.totals?.totalSales ?? 0, currency) }))} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Punto</TableHead>
            <TableHead>Ventas</TableHead>
            <TableHead>Utilidad</TableHead>
            <TableHead>Margen</TableHead>
            <TableHead>Tickets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.locationId}>
              <TableCell>{r.locationName}</TableCell>
              <TableCell>{formatAmount(r.totals?.totalSales ?? 0, currency)}</TableCell>
              <TableCell>{formatAmount(r.totals?.profit ?? null, currency)}</TableCell>
              <TableCell>{formatMargin(r.totals?.margin ?? null)}</TableCell>
              <TableCell>{r.totals?.tickets ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardCard>
  );
}

export async function HealthSection({ data, locationNames }: Props & { locationNames: ReadonlyMap<string, string> }) {
  const health = await data.health;
  return (
    <DashboardCard title={TITLES.health}>{health.ok ? <HealthPanel health={health.data} locationNames={locationNames} /> : <CardError message={health.message} />}</DashboardCard>
  );
}
