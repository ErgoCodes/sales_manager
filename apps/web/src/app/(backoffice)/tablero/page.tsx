import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { CardLoading } from '@/components/dashboard/card';
import { DashboardFilters } from '@/components/dashboard/dashboard-filters';
import { getMe } from '@/lib/api/me';
import { canAny } from '@/lib/permissions';
import { parseFilters, type DashboardSearch } from '@/lib/reports/filters';
import { loadDashboard, reportLocations } from './data';
import { ByLocationSection, HealthSection, SeriesSection, SummarySection, TITLES, TopProductsSection } from './sections';

export const metadata: Metadata = { title: 'Tablero' };

/**
 * KPIs of the period, location and currency in the URL (spec SP4, "Web: dashboard"). Needs `reports:view`;
 * `reports:view_own` alone (cashier) is mobile's "Hoy". Each card streams in its own <Suspense>; nothing is
 * cached (`use cache` never wraps user data) and nothing polls.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardSearch> }) {
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;
  if (!canAny(grants, 'reports:view')) return <NoAccess />;

  const filters = parseFilters(await searchParams);
  const locations = await reportLocations(grants);
  if (!locations.ok) return <ErrorNotice message={locations.message} />;
  const data = loadDashboard(filters);
  const props = { data, filters };
  // Suspense keys: a filter change shows each card's loading state again instead of the stale one.
  const key = JSON.stringify(filters);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tablero</h1>
        <p className="text-sm text-muted-foreground">Ventas, utilidad e inventario del período elegido.</p>
      </div>
      <DashboardFilters filters={filters} locations={locations.data} />
      <Suspense key={`summary${key}`} fallback={<CardLoading title={TITLES.summary} />}>
        <SummarySection {...props} />
      </Suspense>
      <Suspense key={`series${key}`} fallback={<CardLoading title={TITLES.series} />}>
        <SeriesSection {...props} />
      </Suspense>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Suspense key={`top${key}`} fallback={<CardLoading title={TITLES.top} />}>
          <TopProductsSection {...props} />
        </Suspense>
        <Suspense key={`by-location${key}`} fallback={<CardLoading title={TITLES.byLocation} />}>
          <ByLocationSection {...props} />
        </Suspense>
      </div>
      <Suspense key={`health${key}`} fallback={<CardLoading title={TITLES.health} />}>
        <HealthSection {...props} locationNames={new Map(locations.data.map((l) => [l.id, l.name]))} />
      </Suspense>
    </div>
  );
}
