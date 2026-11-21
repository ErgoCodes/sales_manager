import type { Metadata } from 'next';
import Link from 'next/link';
import { CATEGORIES } from '@monaco/domain';
import { FormDialog } from '@/components/admin/form-dialog';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { listAll } from '@/lib/api/list-all';
import { getMe } from '@/lib/api/me';
import { parseId } from '@/lib/admin/form-ids';
import { formatMoney } from '@/lib/catalog/money';
import { canReadCatalog, canSeeCatalogCosts, canTenantWide } from '@/lib/permissions';
import { createProductAction } from './actions';
import { SELECT_CLASS } from './form-field';
import { ProductFormFields } from './product-form-fields';

export const metadata: Metadata = { title: 'Catálogo' };

interface Search {
  q?: string;
  category?: string;
  archived?: string;
  locationId?: string;
  cursor?: string;
}

/**
 * Product list. With a location the prices are that location's effective ones; without one, the
 * base prices. A user who reads the catalog only in some locations starts on the first of them.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const me = await getMe();
  if (!me.ok) return <ErrorNotice message={me.message} />;
  const grants = me.data.permissions;
  if (!canReadCatalog(grants)) return <NoAccess />;

  const locations = await listAll((cursor) => callApi((api) => api.GET('/locations', { params: { query: { cursor, limit: 100 } }, ...requestInit() }), { canRefresh: false }));
  if (!locations.ok) return <ErrorNotice message={locations.message} />;
  const visible = locations.data.filter((l) => !l.archivedAt && canReadCatalog(grants, l.id));
  const tenantReader = canTenantWide(grants, 'catalog:view') || canTenantWide(grants, 'catalog:write');
  const asked = parseId(search.locationId ?? '');
  const locationId = asked && visible.some((l) => l.id === asked) ? asked : tenantReader ? undefined : visible[0]?.id;

  const q = search.q?.trim() || undefined;
  const category = (CATEGORIES as readonly string[]).includes(search.category ?? '') ? search.category : undefined;
  const includeArchived = search.archived === '1';
  const list = await callApi(
    (api) => api.GET('/products', { params: { query: { q, category, includeArchived: includeArchived ? 'true' : undefined, locationId, cursor: search.cursor, limit: 50 } }, ...requestInit() }),
    { canRefresh: false },
  );

  const canWrite = canTenantWide(grants, 'catalog:write');
  const showCosts = canSeeCatalogCosts(grants, locationId);
  const filters: Record<string, string> = {};
  if (q) filters.q = q;
  if (category) filters.category = category;
  if (includeArchived) filters.archived = '1';
  if (locationId) filters.locationId = locationId;
  const columns = 6 + (showCosts ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catálogo</h1>
        {canWrite ? (
          <FormDialog trigger="Nuevo producto" triggerVariant="default" title="Nuevo producto" submitLabel="Crear" action={createProductAction}>
            <ProductFormFields showCost={canSeeCatalogCosts(grants)} />
          </FormDialog>
        ) : null}
      </div>

      <form method="get" action="/catalogo" className="flex flex-wrap items-end gap-3" aria-label="Filtros del catálogo">
        <div className="space-y-1">
          <label htmlFor="catalog-q" className="text-sm font-medium">
            Buscar
          </label>
          <Input id="catalog-q" name="q" defaultValue={q} placeholder="Nombre del producto" maxLength={200} className="w-56" />
        </div>
        <div className="space-y-1">
          <label htmlFor="catalog-category" className="text-sm font-medium">
            Categoría
          </label>
          <select id="catalog-category" name="category" defaultValue={category ?? ''} className={`${SELECT_CLASS} w-44`}>
            <option value="">Todas</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="catalog-location" className="text-sm font-medium">
            Precios de
          </label>
          <select id="catalog-location" name="locationId" defaultValue={locationId ?? ''} className={`${SELECT_CLASS} w-52`}>
            {tenantReader ? <option value="">Precios base</option> : null}
            {visible.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Incluir archivados
        </label>
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
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Unidad</TableHead>
                {showCosts ? <TableHead>Costo</TableHead> : null}
                <TableHead>Efectivo</TableHead>
                <TableHead>Transferencia</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link href={`/catalogo/${product.id}`} className="underline">
                      {product.name}
                    </Link>
                  </TableCell>
                  <TableCell>{product.category ?? '—'}</TableCell>
                  <TableCell>{product.unitOfMeasure}</TableCell>
                  {showCosts ? <TableCell>{formatMoney(product.costPrice)}</TableCell> : null}
                  <TableCell>{formatMoney(product.effectiveCashPrice)}</TableCell>
                  <TableCell>{formatMoney(product.effectiveTransferPrice)}</TableCell>
                  <TableCell>{product.archivedAt ? <Badge variant="secondary">Archivado</Badge> : <Badge>Activo</Badge>}</TableCell>
                </TableRow>
              ))}
              {list.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns}>No hay productos para mostrar.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <Pager basePath="/catalogo" nextCursor={list.data.nextCursor} extraQuery={filters} />
        </>
      )}
    </div>
  );
}
