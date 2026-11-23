import { ArrowDownToLine, Banknote, ReceiptText, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import type { SummaryTotals } from '@/lib/api/types';
import { formatAmount, formatMargin } from '@/lib/reports/format';

function Tile({ label, value, icon: Icon, details = [] }: { label: string; value: string; icon: LucideIcon; details?: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-background p-3.5">
      <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        {label}
        <Icon aria-hidden className="size-4" />
      </dt>
      <dd className="text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {details.map((detail) => (
        <dd key={detail} className="text-xs text-muted-foreground tabular-nums">
          {detail}
        </dd>
      ))}
    </div>
  );
}

/** KPIs of one currency (spec SP4, "Tarjetas"). A null value is a dash, never a zero. */
export function SummaryCards({ totals }: { totals: SummaryTotals }) {
  const money = (amount: number | null) => formatAmount(amount, totals.currency);
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <Tile label="Ventas totales" icon={Banknote} value={money(totals.totalSales)} details={[`Efectivo ${money(totals.cashSales)}`, `Transferencia ${money(totals.transferSales)}`]} />
      <Tile label="Utilidad bruta" icon={TrendingUp} value={money(totals.profit)} details={[`Margen ${formatMargin(totals.margin)}`]} />
      <Tile label="Tickets" icon={ReceiptText} value={String(totals.tickets)} details={[`Ticket promedio ${money(totals.averageTicket)}`]} />
      <Tile
        label="Pérdidas"
        icon={TrendingDown}
        value={money(totals.shrinkageLoss === null || totals.ownerWithdrawals === null ? null : totals.shrinkageLoss + totals.ownerWithdrawals)}
        details={[`Merma ${money(totals.shrinkageLoss)}`, `Retiros ${money(totals.ownerWithdrawals)}`]}
      />
      <Tile label="Entradas valoradas" icon={ArrowDownToLine} value={money(totals.valuedEntries)} />
    </dl>
  );
}
