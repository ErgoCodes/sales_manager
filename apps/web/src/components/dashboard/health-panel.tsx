import type { InventoryHealth } from '@/lib/api/types';
import { formatQuantity } from '@/lib/inventory/format';
import { formatAmount } from '@/lib/reports/format';
import { cn } from '@/lib/utils';

interface Item {
  productId: string;
  locationId: string;
  name: string;
  unitOfMeasure: string;
  quantity: number;
}

function HealthList<T extends Item>({ title, list, detail, locationName, tone }: { title: string; list: { count: number; items: T[] }; detail: (item: T) => string; locationName: (id: string) => string | undefined; tone: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3.5">
      <h3 className="flex items-center justify-between text-sm font-medium">
        {title}
        <span className={cn('min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums', list.count > 0 ? tone : 'bg-muted text-muted-foreground')}>{list.count}</span>
      </h3>
      {list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin productos.</p>
      ) : (
        <ul className="divide-y text-sm">
          {list.items.map((item) => (
            <li key={`${item.locationId}:${item.productId}`} className="py-2 first:pt-0 last:pb-0">
              <p className="flex justify-between gap-2">
                <span className="truncate font-medium">{item.name}</span>
                <span className="shrink-0 tabular-nums">
                  {formatQuantity(item.quantity)} {item.unitOfMeasure}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {detail(item)}
                {locationName(item.locationId) ? ` · ${locationName(item.locationId)}` : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      {list.count > list.items.length ? <p className="text-xs text-muted-foreground">Se muestran los primeros {list.items.length}.</p> : null}
    </div>
  );
}

/** Inventory health at the moment: low stock, stagnant, near expiration, and the value per currency. */
export function HealthPanel({ health, locationNames = new Map() }: { health: InventoryHealth; locationNames?: ReadonlyMap<string, string> }) {
  const name = (id: string) => locationNames.get(id);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-background p-3.5">
        <h3 className="text-sm text-muted-foreground">Valor del inventario</h3>
        {health.inventoryValue.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin stock valorado.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 text-xl font-semibold tracking-tight tabular-nums">
            {health.inventoryValue.map((value) => (
              <li key={value.currency}>{formatAmount(value.amount, value.currency)}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <HealthList title="Bajo stock" list={health.lowStock} detail={(item) => `umbral ${formatQuantity(item.threshold)}`} locationName={name} tone="bg-destructive/10 text-destructive" />
        <HealthList title="Estancados" list={health.stagnant} detail={(item) => (item.lastSaleDate ? `última venta ${item.lastSaleDate}` : 'Nunca vendido')} locationName={name} tone="bg-warning/15 text-foreground" />
        <HealthList title="Por vencer" list={health.nearExpiration} detail={(item) => `vence ${item.expirationDate}`} locationName={name} tone="bg-warning/15 text-foreground" />
      </div>
    </div>
  );
}
