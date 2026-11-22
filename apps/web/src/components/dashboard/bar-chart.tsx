'use client';

// A client component on purpose: rendered from a Server Component, the RSC stream may split the SVG
// children into chunks that arrive late, and React's streaming SSR then emits the pending part as
// <svg style="display:none">, a style attribute the CSP blocks (D13). As a client component the whole
// SVG is rendered in one piece from its props.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface BarItem {
  key: string;
  label: string;
  /** Non-negative magnitude the bar length is proportional to. */
  value: number;
  /** The value as shown (already formatted with its unit or currency). */
  display: string;
}

const WIDTH = 640;
const ROW = 28;
const LABEL = 180;
const VALUE = 130;

/** Horizontal bars, own SVG with presentation attributes only (no `style`, D13), plus the equivalent table. */
export function BarChart({ label, items, valueHeading = 'Valor' }: { label: string; items: readonly BarItem[]; valueHeading?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  const span = WIDTH - LABEL - VALUE;
  const height = ROW * items.length;
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${Math.max(ROW, height)}`} width="100%" height={Math.max(ROW, height)} role="img" aria-label={label} className="text-sky-600 dark:text-sky-400">
        {items.map((item, i) => {
          const width = (Math.max(0, item.value) / max) * span;
          const top = i * ROW;
          return (
            <g key={item.key}>
              <text x={LABEL - 8} y={top + ROW / 2 + 4} fontSize={12} textAnchor="end" className="fill-foreground">
                {item.label.length > 26 ? `${item.label.slice(0, 25)}…` : item.label}
              </text>
              <rect x={LABEL} y={top + 5} width={width.toFixed(1)} height={ROW - 10} fill="currentColor" fillOpacity={0.7}>
                <title>{`${item.label}: ${item.display}`}</title>
              </rect>
              <text x={LABEL + width + 6} y={top + ROW / 2 + 4} fontSize={12} className="fill-foreground">
                {item.display}
              </text>
            </g>
          );
        })}
      </svg>
      <details>
        <summary className="cursor-pointer text-sm">Ver como tabla</summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>{valueHeading}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.key}>
                <TableCell>{item.label}</TableCell>
                <TableCell>{item.display}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
}
