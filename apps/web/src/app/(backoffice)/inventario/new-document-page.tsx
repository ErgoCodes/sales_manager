import Link from 'next/link';
import { uuidv7 } from '@monaco/contracts';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { getMe } from '@/lib/api/me';
import type { StockItem } from '@/lib/api/types';
import { todayDate, type DocumentFormKind, type ProductOption } from '@/lib/inventory/document-form';
import { canAt } from '@/lib/permissions';
import { recordAdjustmentAction, recordEntryAction, recordExitAction } from './actions';
import { allStock, inventoryLocations, pickLocation } from './data';
import { InventoryDocumentForm } from './document-form';

/** Documents of a single location; transfers have their own page (origin and destination). */
type SingleLocationKind = Exclude<DocumentFormKind, 'transfer'>;

const TITLES: Record<SingleLocationKind, string> = { entry: 'Registrar entrada', exit: 'Registrar salida', adjustment: 'Registrar ajuste' };
const ACTIONS = { entry: recordEntryAction, exit: recordExitAction, adjustment: recordAdjustmentAction };
const HELP: Record<SingleLocationKind, string> = {
  entry: 'Mercancía que llega al punto, con su costo unitario en la moneda del producto.',
  exit: 'Mercancía que sale del punto por merma o retiro del propietario.',
  adjustment: 'Corrige el stock tras un conteo: cantidades positivas suman y negativas restan.',
};

/** Form options from the stock rows. The product currency comes with the average cost, visible to `inventory:write` (D10). */
export function productOptions(items: readonly StockItem[]): ProductOption[] {
  return items.map((item) => ({
    id: item.productId,
    name: item.name,
    unitOfMeasure: item.unitOfMeasure,
    currency: item.averageCost?.currency ?? null,
    quantity: item.quantity,
    archived: item.archivedAt !== null,
  }));
}

/**
 * Page of a new inventory document in one location (`inventory:write` there). The document `id` is
 * generated here, when the page renders: a double submit or a retry of this form is one document.
 */
export async function NewDocumentPage({ kind, searchParams }: { kind: SingleLocationKind; searchParams: Promise<{ locationId?: string }> }) {
  const { locationId: asked } = await searchParams;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;

  const locations = await inventoryLocations(grants);
  if (!locations.ok) return <ErrorNotice message={locations.message} />;
  const location = locations.data.find((l) => l.id === asked) ?? (asked ? undefined : pickLocation(locations.data, undefined));
  if (!location || !canAt(grants, 'inventory:write', location.id)) return <NoAccess />;
  const back = `/inventario?locationId=${location.id}`;
  if (kind === 'entry' && location.archivedAt) return <ErrorNotice message="El punto de venta está archivado: no admite entradas." />;

  const stock = await allStock(location.id);
  if (!stock.ok) return <ErrorNotice message={stock.message} />;

  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm underline">
        ← Inventario
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{TITLES[kind]}</h1>
        <p className="text-sm opacity-70">
          {location.name} · {HELP[kind]}
        </p>
      </div>
      <InventoryDocumentForm kind={kind} documentId={uuidv7()} locationId={location.id} products={productOptions(stock.data)} today={todayDate()} action={ACTIONS[kind]} cancelHref={back} />
    </div>
  );
}
