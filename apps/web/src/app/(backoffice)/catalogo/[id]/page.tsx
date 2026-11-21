import type { Metadata } from 'next';
import Link from 'next/link';
import { UNITS_OF_MEASURE } from '@monaco/domain';
import { FormDialog } from '@/components/admin/form-dialog';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { listAll } from '@/lib/api/list-all';
import { getMe } from '@/lib/api/me';
import { parseId } from '@/lib/admin/form-ids';
import { formatMoney } from '@/lib/catalog/money';
import { canAt, canReadCatalog, canSeeCatalogCosts, canTenantWide } from '@/lib/permissions';
import { archiveProductAction, setLocationPriceAction, updateProductAction } from '../actions';
import { LocationPriceFields } from '../location-price-fields';
import { ProductFormFields } from '../product-form-fields';

export const metadata: Metadata = { title: 'Producto' };

/** Product detail: base data, product actions (tenant-wide `catalog:write`) and prices per visible location. */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return <ErrorNotice message="El producto indicado no existe." />;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;
  if (!canReadCatalog(grants)) return <NoAccess />;

  const [product, locations] = await Promise.all([
    callApi((api) => api.GET('/products/{id}', { params: { path: { id } }, ...requestInit() }), { canRefresh: false }),
    listAll((cursor) => callApi((api) => api.GET('/locations', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false })),
  ]);
  if (!product.ok) return <ErrorNotice message={product.message} />;
  if (!locations.ok) return <ErrorNotice message={locations.message} />;

  const visible = locations.data.filter((l) => !l.archivedAt && canReadCatalog(grants, l.id));
  const prices = await Promise.all(
    visible.map(async (location) => ({
      location,
      price: await callApi((api) => api.GET('/products/{id}', { params: { path: { id }, query: { locationId: location.id } }, ...requestInit() }), { canRefresh: false }),
    })),
  );

  const p = product.data;
  const archived = p.archivedAt !== null;
  const canWrite = canTenantWide(grants, 'catalog:write') && !archived;
  const showCost = canSeeCatalogCosts(grants);
  const unit = UNITS_OF_MEASURE.find((u) => u.value === p.unitOfMeasure)?.label ?? p.unitOfMeasure;

  return (
    <div className="space-y-4">
      <Link href="/catalogo" className="text-sm underline">
        ← Catálogo
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          {archived ? <Badge variant="secondary">Archivado</Badge> : <Badge>Activo</Badge>}
        </div>
        {canWrite ? (
          <div className="space-x-2">
            <FormDialog trigger="Editar" title={`Editar ${p.name}`} submitLabel="Guardar" action={updateProductAction}>
              <ProductFormFields product={p} showCost={showCost} />
            </FormDialog>
            <FormDialog trigger="Archivar" destructive title={`Archivar ${p.name}`} description="El producto dejará de aceptar precios por punto y entradas de inventario." submitLabel="Archivar" action={archiveProductAction}>
              <input type="hidden" name="id" value={p.id} />
            </FormDialog>
          </div>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium">Categoría</dt>
        <dd>{p.category ?? '—'}</dd>
        <dt className="font-medium">Unidad de medida</dt>
        <dd>{unit}</dd>
        <dt className="font-medium">Moneda</dt>
        <dd>{p.currency}</dd>
        {showCost ? (
          <>
            <dt className="font-medium">Costo</dt>
            <dd>{formatMoney(p.costPrice)}</dd>
          </>
        ) : null}
        <dt className="font-medium">Precio base en efectivo</dt>
        <dd>{formatMoney(p.cashPrice)}</dd>
        <dt className="font-medium">Precio base por transferencia</dt>
        <dd>{formatMoney(p.transferPrice)}</dd>
        <dt className="font-medium">Umbral de bajo stock</dt>
        <dd>{p.lowStockThreshold ?? 'El de la categoría'}</dd>
        <dt className="font-medium">Vencimiento</dt>
        <dd>{p.expirationDate ?? '—'}</dd>
      </dl>

      <h2 className="text-lg font-medium">Precios por punto de venta</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Punto de venta</TableHead>
            <TableHead>Efectivo</TableHead>
            <TableHead>Transferencia</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {prices.map(({ location, price }) => (
            <TableRow key={location.id}>
              <TableCell>{location.name}</TableCell>
              {price.ok ? (
                <>
                  <TableCell>
                    {formatMoney(price.data.effectiveCashPrice)}
                    {price.data.cashPriceOverride ? <span className="ml-1 text-xs opacity-70">(propio del punto)</span> : null}
                  </TableCell>
                  <TableCell>
                    {formatMoney(price.data.effectiveTransferPrice)}
                    {price.data.transferPriceOverride ? <span className="ml-1 text-xs opacity-70">(propio del punto)</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {!archived && canAt(grants, 'catalog:write', location.id) ? (
                      <FormDialog trigger="Fijar precio" title={`Precio de ${p.name} en ${location.name}`} submitLabel="Guardar" action={setLocationPriceAction}>
                        <LocationPriceFields
                          productId={p.id}
                          locationId={location.id}
                          currency={p.currency}
                          basePrices={{ cash: p.cashPrice, transfer: p.transferPrice }}
                          overrides={{ cash: price.data.cashPriceOverride, transfer: price.data.transferPriceOverride }}
                        />
                      </FormDialog>
                    ) : null}
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={3}>{price.message}</TableCell>
              )}
            </TableRow>
          ))}
          {prices.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>No hay puntos de venta para mostrar.</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
