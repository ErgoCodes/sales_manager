import type { Metadata } from 'next';
import { FormDialog } from '@/components/admin/form-dialog';
import { ErrorNotice } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { canAny } from '@/lib/permissions';
import { archiveLocationAction, createLocationAction, updateLocationAction } from './actions';
import { LocationFields } from './location-fields';

export const metadata: Metadata = { title: 'Puntos de venta' };

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const [me, list] = await Promise.all([getMe(), callApi((api) => api.GET('/locations', { params: { query: { cursor, limit: 50 } }, ...requestInit() }), { canRefresh: false })]);
  const canManage = me.ok && canAny(me.data.permissions, 'locations:manage');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Puntos de venta</h1>
        {canManage ? (
          <FormDialog trigger="Nuevo punto de venta" triggerVariant="default" title="Nuevo punto de venta" submitLabel="Crear" action={createLocationAction}>
            <LocationFields />
          </FormDialog>
        ) : null}
      </div>
      {!list.ok ? (
        <ErrorNotice message={list.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Estado</TableHead>
                {canManage ? <TableHead className="text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((location) => (
                <TableRow key={location.id}>
                  <TableCell>{location.name}</TableCell>
                  <TableCell>{location.code}</TableCell>
                  <TableCell>{location.archivedAt ? <Badge variant="secondary">Archivado</Badge> : <Badge>Activo</Badge>}</TableCell>
                  {canManage ? (
                    <TableCell className="space-x-2 text-right">
                      {location.archivedAt ? null : (
                        <>
                          <FormDialog trigger="Editar" title={`Editar ${location.name}`} submitLabel="Guardar" action={updateLocationAction}>
                            <LocationFields id={location.id} name={location.name} code={location.code} />
                          </FormDialog>
                          <FormDialog trigger="Archivar" destructive title={`Archivar ${location.name}`} description="El punto de venta dejará de estar disponible para nuevas operaciones." submitLabel="Archivar" action={archiveLocationAction}>
                            <input type="hidden" name="id" value={location.id} />
                          </FormDialog>
                        </>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {list.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 4 : 3}>No hay puntos de venta para mostrar.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <Pager basePath="/puntos-de-venta" nextCursor={list.data.nextCursor} />
        </>
      )}
    </div>
  );
}
