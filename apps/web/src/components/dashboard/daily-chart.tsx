'use client';

import type { CurrencyCode } from '@monaco/contracts';
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { useMounted } from '@/lib/hooks/use-mounted';
import { formatAmount, formatCompactAmount, formatShortDate } from '@/lib/reports/format';
import { AXIS_TICK, ChartPlaceholder, ChartTable, GRID_STROKE, TooltipCard } from './chart-parts';

export interface DailyPoint {
  date: string;
  totalSales: number;
  profit: number;
}

/**
 * Daily sales (columns) and profit (line), drawn with Recharts on the client only: Recharts sets
 * inline styles, which the CSP allows from the CSSOM but blocks in server HTML (D13). No animation:
 * it is functional data, read many times a day. The table below is the accessible equivalent.
 */
export function DailyChart({ points, currency }: { points: readonly DailyPoint[]; currency: CurrencyCode }) {
  const mounted = useMounted();
  return (
    <div className="space-y-3">
      <div role="img" aria-label={`Ventas y utilidad por día en ${currency}`} className="h-64 w-full">
        {mounted ? (
          <ComposedChart responsive data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} style={{ width: '100%', height: '100%' }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickFormatter={formatCompactAmount} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              isAnimationActive={false}
              content={({ active, payload, label }) => {
                const point = payload?.[0]?.payload as DailyPoint | undefined;
                if (!active || !point) return null;
                return (
                  <TooltipCard
                    title={formatShortDate(String(label))}
                    rows={[
                      { label: 'Ventas', value: formatAmount(point.totalSales, currency), swatch: 'bg-chart-1' },
                      { label: 'Utilidad', value: formatAmount(point.profit, currency), swatch: 'bg-chart-2' },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="totalSales" name="Ventas" fill="var(--chart-1)" fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
            <Line dataKey="profit" name="Utilidad" type="monotone" stroke="var(--chart-2)" strokeWidth={2.5} dot={points.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        ) : (
          <ChartPlaceholder className="h-full" />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul aria-label="Leyenda" className="flex gap-4 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-chart-1" /> Ventas
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3 rounded-full bg-chart-2" /> Utilidad
          </li>
        </ul>
      </div>
      <ChartTable
        headings={['Día', 'Ventas', 'Utilidad']}
        rows={points.map((p) => ({ key: p.date, cells: [p.date, formatAmount(p.totalSales, currency), formatAmount(p.profit, currency)] }))}
      />
    </div>
  );
}
