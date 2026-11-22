'use client';

import { Bar, BarChart as RechartsBarChart, LabelList, Tooltip, XAxis, YAxis } from 'recharts';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useMounted } from '@/lib/hooks/use-mounted';
import { AXIS_TICK, ChartPlaceholder, ChartTable, TooltipCard } from './chart-parts';

export interface BarItem {
  key: string;
  label: string;
  /** Non-negative magnitude the bar length is proportional to. */
  value: number;
  /** The value as shown (already formatted with its unit or currency). */
  display: string;
}

const ROW = 36;

const truncate = (label: string, max: number) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

/**
 * Horizontal bars with Recharts, client only (inline styles, D13), no animation (functional data).
 * The value is printed at the end of each bar. The folded table is the accessible equivalent; pass
 * `table={false}` only when the caller already shows a table with the same data.
 */
export function BarChart({ label, items, valueHeading = 'Valor', table = true }: { label: string; items: readonly BarItem[]; valueHeading?: string; table?: boolean }) {
  const mounted = useMounted();
  // Narrow screens: a shorter label column leaves room for the bars and their values.
  const wide = useMediaQuery('(min-width: 640px)');
  const data = items.map((item) => ({ ...item, value: Math.max(0, item.value) }));
  return (
    <div className="space-y-3">
      <div role="img" aria-label={label} className="w-full">
        {mounted ? (
          <RechartsBarChart
            responsive
            layout="vertical"
            data={data}
            margin={{ top: 0, right: wide ? 112 : 88, bottom: 0, left: 0 }}
            barCategoryGap={8}
            style={{ width: '100%', height: Math.max(1, data.length) * ROW }}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="label" tickFormatter={(value: string) => truncate(value, wide ? 24 : 14)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={wide ? 168 : 96} />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as BarItem | undefined;
                if (!active || !item) return null;
                return <TooltipCard title={item.label} rows={[{ label: valueHeading, value: item.display, swatch: 'bg-chart-1' }]} />;
              }}
            />
            <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
              <LabelList dataKey="display" position="right" fill="var(--foreground)" fontSize={12} />
            </Bar>
          </RechartsBarChart>
        ) : (
          <ChartPlaceholder className="h-40" />
        )}
      </div>
      {table ? <ChartTable headings={['Nombre', valueHeading]} rows={items.map((item) => ({ key: item.key, cells: [item.label, item.display] }))} /> : null}
    </div>
  );
}
