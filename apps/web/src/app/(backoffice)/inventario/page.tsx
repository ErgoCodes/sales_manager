import type { Metadata } from 'next';
import Link from 'next/link';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { formatAverageCost, formatQuantity } from '@/lib/inventory/format';
import { canAt, canReadInventory } from '@/lib/permissions';
import { SELECT_CLASS } from '../catalogo/form-field';
import { inventoryLocations, pickLocation } from './data';

export const metadata: Metadata = { title: 'Inventario' };

interface Search {
  locationId?: string;
  q?: string;
  low?: string;
  cursor?: string;
  registrado?: string;
}

/**
 * Stock of one location (selector: the locations the user reads). The average cost column appears
 * only when the API returns it (D10); write actions only with `inventory:write` there.
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;
  if (!canReadInventory(grants)) return <NoAccess />;

  const locations = await inventoryLocations(grants);
  if (!locations.ok) return <ErrorNotice message={locations.message} />;
  const location = pickLocation(locations.data, search.locationId);
  if (!location) return <ErrorNotice message="No hay puntos de venta con inventario para mostrar." />;

  const q = search.q?.trim() || undefined;
  const lowOnly = search.low === '1';
  const stock = await callApi(
    (api) =>
      api.GET('/locations/{locationId}/stock', {
        params: { path: { locationId: location.id }, query: { q, lowStockOnly: lowOnly ? 'true' : undefined, cursor: search.cursor, limit: 50 } },
        ...requestInit(),
      }),
    { canRefresh: false },
  );

  const canWrite = canAt(grants, 'inventory:write', location.id);
  const archived = location.archivedAt !== null;
  const filters: Record<string, string> = { locationId: location.id };
  if (q) filters.q = q;
  if (lowOnly) filters.low = '1';
  const showCost = stock.ok && stock.data.items.some((item) => item.averageCost !== null);
  const at = `?locationId=${location.id}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/inventario/movimientos${at}`}>Movimientos</Link>
          </Button>
          {canWrite ? (
            <>
              {archived ? null : (
                <Button asChild size="sm">
                  <Link href={`/inventario/entradas/nueva${at}`}>Registrar entrada</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link href={`/inventario/salidas/nueva${at}`}>Registrar salida</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/inventario/ajustes/nuevo${at}`}>Registrar ajuste</Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {search.registrado === '1' ? (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Documento registrado.
        </p>
      ) : null}

      <form method="get" action="/inventario" className="flex flex-wrap items-end gap-3" aria-label="Filtros del inventario">
        <div className="space-y-1">
          <label htmlFor="inventory-location" className="text-sm font-medium">
            Punto de venta
          </label>
          <select id="inventory-location" name="locationId" defaultValue={location.id} className={`${SELECT_CLASS} w-52`}>
            {locations.data.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.archivedAt ? ' (archivado)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="inventory-q" className="text-sm font-medium">
            Buscar
          </label>
          <Input id="inventory-q" name="q" defaultValue={q} placeholder="Nombre del producto" maxLength={200} className="w-56" />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="low" value="1" defaultChecked={lowOnly} />
          Solo bajo stock
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filtrar
        </Button>
      </form>

      {archived ? <p className="text-sm opacity-70">Este punto de venta está archivado: admite salidas y ajustes para vaciar su stock, pero no entradas.</p> : null}

      {!stock.ok ? (
        <ErrorNotice message={stock.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead>Umbral</TableHead>
                {showCost ? <TableHead>Costo promedio</TableHead> : null}
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.data.items.map((item) => (
                <TableRow key={item.productId}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.category ?? '—'}</TableCell>
                  <TableCell>
                    {formatQuantity(item.quantity)} {item.unitOfMeasure}
                  </TableCell>
                  <TableCell>{formatQuantity(item.lowStockThreshold)}</TableCell>
                  {showCost ? <TableCell>{formatAverageCost(item.averageCost)}</TableCell> : null}
                  <TableCell className="space-x-1">
                    {item.isLow ? <Badge variant="destructive">Bajo stock</Badge> : null}
                    {item.archivedAt ? <Badge variant="secondary">Archivado</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
              {stock.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showCost ? 6 : 5}>No hay productos para mostrar.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <Pager basePath="/inventario" nextCursor={stock.data.nextCursor} extraQuery={filters} />
        </>
      )}
    </div>
  );
}
