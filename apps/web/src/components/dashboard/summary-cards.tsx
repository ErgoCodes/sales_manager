import type { SummaryTotals } from '@/lib/api/types';
import { formatAmount, formatMargin } from '@/lib/reports/format';

function Tile({ label, value, detail }: { label: string; value: string; detail?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-sm opacity-70">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {detail ? <dd className="text-xs opacity-70">{detail}</dd> : null}
    </div>
  );
}

/** KPIs of one currency (spec SP4, "Tarjetas"). A null value is a dash, never a zero. */
export function SummaryCards({ totals }: { totals: SummaryTotals }) {
  const money = (amount: number | null) => formatAmount(amount, totals.currency);
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Ventas totales" value={money(totals.totalSales)} detail={`Efectivo ${money(totals.cashSales)} · Transferencia ${money(totals.transferSales)}`} />
      <Tile label="Utilidad bruta" value={money(totals.profit)} detail={`Margen ${formatMargin(totals.margin)}`} />
      <Tile label="Tickets" value={String(totals.tickets)} detail={`Ticket promedio ${money(totals.averageTicket)}`} />
      <Tile
        label="Pérdidas"
        value={money(totals.shrinkageLoss === null || totals.ownerWithdrawals === null ? null : totals.shrinkageLoss + totals.ownerWithdrawals)}
        detail={`Merma ${money(totals.shrinkageLoss)} · Retiros ${money(totals.ownerWithdrawals)}`}
      />
      <Tile label="Entradas valoradas" value={money(totals.valuedEntries)} />
    </dl>
  );
}
