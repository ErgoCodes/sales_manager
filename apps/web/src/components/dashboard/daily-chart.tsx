'use client';

// A client component on purpose: rendered from a Server Component, the RSC stream may split the SVG
// children into chunks that arrive late, and React's streaming SSR then emits the pending part as
// <svg style="display:none">, a style attribute the CSP blocks (D13). As a client component the whole
// SVG is rendered in one piece from its props.
import type { CurrencyCode } from '@monaco/contracts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount } from '@/lib/reports/format';

export interface DailyPoint {
  date: string;
  totalSales: number;
  profit: number;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 8 };

/**
 * Daily sales (columns) and profit (line). Own SVG with presentation attributes only, never `style`
 * (the CSP allows only nonce'd styles, D13); colors come from classes. The table below is the equivalent.
 */
export function DailyChart({ points, currency }: { points: readonly DailyPoint[]; currency: CurrencyCode }) {
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(1, ...points.map((p) => Math.max(p.totalSales, p.profit)));
  const min = Math.min(0, ...points.map((p) => p.profit));
  const y = (value: number) => PAD.top + ((max - value) / (max - min)) * innerHeight;
  const band = innerWidth / Math.max(1, points.length);
  const center = (index: number) => PAD.left + band * index + band / 2;
  const barWidth = Math.max(1, band * 0.7);
  const zero = y(0);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${center(i).toFixed(1)} ${y(p.profit).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points.at(-1);

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={`Ventas y utilidad por día en ${currency}`} className="text-sky-600 dark:text-sky-400">
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={zero} y2={zero} stroke="currentColor" strokeOpacity={0.3} />
        {points.map((p, i) => {
          const top = y(p.totalSales);
          return (
            <rect key={p.date} x={(center(i) - barWidth / 2).toFixed(1)} y={top.toFixed(1)} width={barWidth.toFixed(1)} height={Math.max(0, zero - top).toFixed(1)} fill="currentColor" fillOpacity={0.7}>
              <title>{`${p.date}: ventas ${formatAmount(p.totalSales, currency)}, utilidad ${formatAmount(p.profit, currency)}`}</title>
            </rect>
          );
        })}
        {points.length > 0 ? <path d={line} fill="none" strokeWidth={2} className="stroke-emerald-600 dark:stroke-emerald-400" /> : null}
        {points.length === 1 && first ? <circle cx={center(0)} cy={y(first.profit)} r={3} className="fill-emerald-600 dark:fill-emerald-400" /> : null}
        {first ? (
          <text x={PAD.left} y={HEIGHT - 6} fontSize={11} fill="currentColor">
            {first.date}
          </text>
        ) : null}
        {last && last !== first ? (
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} fontSize={11} textAnchor="end" fill="currentColor">
            {last.date}
          </text>
        ) : null}
      </svg>
      <p className="text-xs opacity-70">Columnas: ventas · Línea: utilidad</p>
      <details>
        <summary className="cursor-pointer text-sm">Ver como tabla</summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Día</TableHead>
              <TableHead>Ventas</TableHead>
              <TableHead>Utilidad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((p) => (
              <TableRow key={p.date}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{formatAmount(p.totalSales, currency)}</TableCell>
                <TableCell>{formatAmount(p.profit, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
}
