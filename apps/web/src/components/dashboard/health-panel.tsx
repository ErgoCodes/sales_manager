import type { InventoryHealth } from '@/lib/api/types';
import { formatQuantity } from '@/lib/inventory/format';
import { formatAmount } from '@/lib/reports/format';

interface Item {
  productId: string;
  locationId: string;
  name: string;
  unitOfMeasure: string;
  quantity: number;
}

function HealthList<T extends Item>({ title, list, detail, locationName }: { title: string; list: { count: number; items: T[] }; detail: (item: T) => string; locationName: (id: string) => string | undefined }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <h3 className="flex items-baseline justify-between text-sm font-medium">
        {title} <span className="text-xl font-semibold tabular-nums">{list.count}</span>
      </h3>
      {list.items.length === 0 ? (
        <p className="text-sm opacity-70">Sin productos.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {list.items.map((item) => (
            <li key={`${item.locationId}:${item.productId}`}>
              <span className="font-medium">{item.name}</span> · {formatQuantity(item.quantity)} {item.unitOfMeasure} · {detail(item)}
              {locationName(item.locationId) ? <span className="opacity-70"> · {locationName(item.locationId)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {list.count > list.items.length ? <p className="text-xs opacity-70">Se muestran los primeros {list.items.length}.</p> : null}
    </div>
  );
}

/** Inventory health at the moment: low stock, stagnant, near expiration, and the value per currency. */
export function HealthPanel({ health, locationNames = new Map() }: { health: InventoryHealth; locationNames?: ReadonlyMap<string, string> }) {
  const name = (id: string) => locationNames.get(id);
  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        <h3 className="text-sm font-medium">Valor del inventario</h3>
        {health.inventoryValue.length === 0 ? (
          <p className="text-sm opacity-70">Sin stock valorado.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 text-xl font-semibold tabular-nums">
            {health.inventoryValue.map((value) => (
              <li key={value.currency}>{formatAmount(value.amount, value.currency)}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <HealthList title="Bajo stock" list={health.lowStock} detail={(item) => `umbral ${formatQuantity(item.threshold)}`} locationName={name} />
        <HealthList title="Estancados" list={health.stagnant} detail={(item) => (item.lastSaleDate ? `última venta ${item.lastSaleDate}` : 'Nunca vendido')} locationName={name} />
        <HealthList title="Por vencer" list={health.nearExpiration} detail={(item) => `vence ${item.expirationDate}`} locationName={name} />
      </div>
    </div>
  );
}
