import type { CurrencyCode } from '@monaco/contracts';
import { SegmentedLinks } from '@/components/ui/segmented-links';
import { dashboardHref, type DashboardFilters } from '@/lib/reports/filters';

/** One tab per currency with data in the period; amounts are never converted between currencies (D6). */
export function CurrencyTabs({ currencies, selected, filters }: { currencies: readonly CurrencyCode[]; selected: CurrencyCode | undefined; filters: DashboardFilters }) {
  if (currencies.length === 0) return null;
  return (
    <SegmentedLinks
      label="Moneda"
      items={currencies.map((currency) => ({ key: currency, href: dashboardHref(filters, { currency }), label: currency, active: currency === selected }))}
    />
  );
}
