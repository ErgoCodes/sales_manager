import type { Metadata } from 'next';
import Link from 'next/link';
import { INVENTORY_MOVEMENT_KINDS, type InventoryMovementKind } from '@monaco/contracts';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { parseId } from '@/lib/admin/form-ids';
import { formatDateTime } from '@/lib/audit-labels';
import { MOVEMENT_KIND_LABELS, counterpartName, formatAverageCost, formatSignedQuantity } from '@/lib/inventory/format';
import { canReadInventory } from '@/lib/permissions';
import { SELECT_CLASS } from '../../catalogo/form-field';
import { inventoryLocations, pickLocation, productInfo, productLabel } from '../data';

export const metadata: Metadata = { title: 'Movimientos de inventario' };

interface Search {
  locationId?: string;
  productId?: string;
  kind?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A `YYYY-MM-DD` filter as the start or end of that UTC day (the dates of the ledger are shown in UTC). */
function dayBound(value: string | undefined, end: boolean): string | undefined {
  if (!value || !DATE.test(value)) return undefined;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isKind(value: string | undefined): value is InventoryMovementKind {
  return (INVENTORY_MOVEMENT_KINDS as readonly string[]).includes(value ?? '');
}

/** Ledger of one location, newest first, with filters. Read-only: reverting arrives in T8b. */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;
  if (!canReadInventory(grants)) return <NoAccess />;

  const locations = await inventoryLocations(grants);
  if (!locations.ok) return <ErrorNotice message={locations.message} />;
  const location = pickLocation(locations.data, search.locationId);
  if (!location) return <ErrorNotice message="No hay puntos de venta con inventario para mostrar." />;

  const productId = parseId(search.productId ?? '') ?? undefined;
  const kind = isKind(search.kind) ? search.kind : undefined;
  const from = dayBound(search.from, false);
  const to = dayBound(search.to, true);
  const [list, products] = await Promise.all([
    callApi(
      (api) =>
        api.GET('/locations/{locationId}/inventory-movements', {
          params: { path: { locationId: location.id }, query: { productId, kind, from, to, cursor: search.cursor, limit: 50 } },
          ...requestInit(),
        }),
      { canRefresh: false },
    ),
    productInfo([location.id]),
  ]);

  const filters: Record<string, string> = { locationId: location.id };
  if (productId) filters.productId = productId;
  if (kind) filters.kind = kind;
  if (from) filters.from = search.from!;
  if (to) filters.to = search.to!;
  const showCost = list.ok && list.data.items.some((m) => m.unitCost !== null);

  return (
    <div className="space-y-4">
      <Link href={`/inventario?locationId=${location.id}`} className="text-sm underline">
        ← Inventario
      </Link>
      <h1 className="text-2xl font-semibold">Movimientos</h1>

      <form method="get" action="/inventario/movimientos" className="flex flex-wrap items-end gap-3" aria-label="Filtros de movimientos">
        <div className="space-y-1">
          <label htmlFor="movements-location" className="text-sm font-medium">
            Punto de venta
          </label>
          <select id="movements-location" name="locationId" defaultValue={location.id} className={`${SELECT_CLASS} w-48`}>
            {locations.data.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.archivedAt ? ' (archivado)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="movements-product" className="text-sm font-medium">
            Producto
          </label>
          <select id="movements-product" name="productId" defaultValue={productId ?? ''} className={`${SELECT_CLASS} w-48`}>
            <option value="">Todos</option>
            {[...products].map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="movements-kind" className="text-sm font-medium">
            Tipo
          </label>
          <select id="movements-kind" name="kind" defaultValue={kind ?? ''} className={`${SELECT_CLASS} w-48`}>
            <option value="">Todos</option>
            {INVENTORY_MOVEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {MOVEMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="movements-from" className="text-sm font-medium">
            Desde (UTC)
          </label>
          <Input id="movements-from" name="from" type="date" defaultValue={from ? search.from : undefined} className="w-40" />
        </div>
        <div className="space-y-1">
          <label htmlFor="movements-to" className="text-sm font-medium">
            Hasta (UTC)
          </label>
          <Input id="movements-to" name="to" type="date" defaultValue={to ? search.to : undefined} className="w-40" />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Filtrar
        </Button>
      </form>

      {!list.ok ? (
        <ErrorNotice message={list.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha (UTC)</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Cantidad</TableHead>
                {showCost ? <TableHead>Costo unitario</TableHead> : null}
                <TableHead>Punto relacionado</TableHead>
                <TableHead>Documento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                  <TableCell>{MOVEMENT_KIND_LABELS[m.kind]}</TableCell>
                  <TableCell title={m.productId}>{productLabel(products, m.productId)}</TableCell>
                  <TableCell>
                    {formatSignedQuantity(m.quantityDelta)} {products.get(m.productId)?.unitOfMeasure ?? ''}
                  </TableCell>
                  {showCost ? <TableCell>{formatAverageCost(m.unitCost)}</TableCell> : null}
                  <TableCell>{counterpartName(m)}</TableCell>
                  <TableCell>
                    <Link href={`/inventario/movimientos/${m.documentId}`} className="underline">
                      Ver documento
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {list.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showCost ? 7 : 6}>No hay movimientos para mostrar.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <Pager basePath="/inventario/movimientos" nextCursor={list.data.nextCursor} extraQuery={filters} />
        </>
      )}
    </div>
  );
}
