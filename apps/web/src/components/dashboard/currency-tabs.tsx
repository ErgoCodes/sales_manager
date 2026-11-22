import Link from 'next/link';
import type { CurrencyCode } from '@monaco/contracts';
import { dashboardHref, type DashboardFilters } from '@/lib/reports/filters';
import { cn } from '@/lib/utils';

/** One tab per currency with data in the period; amounts are never converted between currencies (D6). */
export function CurrencyTabs({ currencies, selected, filters }: { currencies: readonly CurrencyCode[]; selected: CurrencyCode | undefined; filters: DashboardFilters }) {
  if (currencies.length === 0) return null;
  return (
    <nav aria-label="Moneda" className="flex gap-1">
      {currencies.map((currency) => {
        const active = currency === selected;
        return (
          <Link
            key={currency}
            href={dashboardHref(filters, { currency })}
            aria-current={active ? 'page' : undefined}
            className={cn('rounded-md border px-3 py-1 text-sm', active ? 'bg-foreground text-background' : 'hover:bg-muted')}
          >
            {currency}
          </Link>
        );
      })}
    </nav>
  );
}
