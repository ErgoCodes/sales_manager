'use client';

import { ChevronRight } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Axis ticks and grid colors, as SVG presentation attributes. */
export const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;
export const GRID_STROKE = 'var(--chart-grid)';

/** Server HTML (and the first client render) of a chart: same footprint, no `style` attribute. */
export function ChartPlaceholder({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton w-full', className)} />;
}

export interface TooltipRow {
  label: string;
  value: string;
  /** Tailwind background class of the series swatch. */
  swatch?: string;
}

export function TooltipCard({ title, rows }: { title?: string; rows: readonly TooltipRow[] }) {
  return (
    <div className="min-w-40 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {title ? <p className="mb-1.5 font-medium">{title}</p> : null}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.swatch ? <span aria-hidden className={cn('size-2 rounded-full', row.swatch)} /> : null}
              {row.label}
            </span>
            <span className="font-medium tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The chart's data as a table, folded by default: the accessible equivalent of the drawing. */
export function ChartTable({ headings, rows }: { headings: readonly string[]; rows: readonly { key: string; cells: readonly string[] }[] }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" />
        Ver como tabla
      </summary>
      <div className="mt-2">
        <Table>
          <TableHeader>
            <TableRow>
              {headings.map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                {row.cells.map((cell, i) => (
                  <TableCell key={i} className={i > 0 ? 'tabular-nums' : undefined}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}
