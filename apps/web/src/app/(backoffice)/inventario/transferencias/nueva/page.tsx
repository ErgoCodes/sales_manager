import type { Metadata } from 'next';
import Link from 'next/link';
import { uuidv7 } from '@monaco/contracts';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Button } from '@/components/ui/button';
import { getMe } from '@/lib/api/me';
import { todayDate } from '@/lib/inventory/document-form';
import { SELECT_CLASS } from '../../../catalogo/form-field';
import { recordTransferAction } from '../../actions';
import { allStock, inventoryLocations, pickLocation, transferLocations } from '../../data';
import { InventoryDocumentForm } from '../../document-form';
import { productOptions } from '../../new-document-page';

export const metadata: Metadata = { title: 'Registrar transferencia' };

/**
 * New transfer (D6: one atomic document). D7: `inventory:transfer` at the origin and at the destination,
 * so both selectors only list those locations; an archived location can send but not receive (D15).
 * Products come from the origin's stock, so changing the origin reloads the page (and the document `id`,
 * which is generated here when the page renders: a double submit of the form is one document).
 */
export default async function NewTransferPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId: asked } = await searchParams;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;

  const locations = await inventoryLocations(grants);
  if (!locations.ok) return <ErrorNotice message={locations.message} />;
  const origins = transferLocations(locations.data, grants);
  if (origins.length < 2) return <NoAccess />;
  const origin = asked ? origins.find((l) => l.id === asked) : pickLocation(origins, undefined);
  if (!origin) return <NoAccess />;

  const destinations = origins.filter((l) => l.id !== origin.id && !l.archivedAt);
  if (destinations.length === 0) return <ErrorNotice message="No hay otro punto de venta activo de destino: un punto archivado no recibe transferencias." />;

  const stock = await allStock(origin.id);
  if (!stock.ok) return <ErrorNotice message={stock.message} />;
  const back = `/inventario?locationId=${origin.id}`;

  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm underline">
        ← Inventario
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Registrar transferencia</h1>
        <p className="text-sm opacity-70">Mueve mercancía del punto de origen al de destino en un solo paso.</p>
      </div>

      <form method="get" action="/inventario/transferencias/nueva" className="flex flex-wrap items-end gap-3" aria-label="Origen de la transferencia">
        <div className="space-y-1">
          <label htmlFor="transfer-origin" className="text-sm font-medium">
            Origen
          </label>
          <select id="transfer-origin" name="locationId" defaultValue={origin.id} className={`${SELECT_CLASS} w-52`}>
            {origins.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.archivedAt ? ' (archivado)' : ''}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Cambiar origen
        </Button>
      </form>

      <InventoryDocumentForm
        kind="transfer"
        documentId={uuidv7()}
        locationId={origin.id}
        destinations={destinations}
        products={productOptions(stock.data)}
        today={todayDate()}
        action={recordTransferAction}
        cancelHref={back}
      />
    </div>
  );
}
