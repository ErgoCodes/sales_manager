import type { Metadata } from 'next';
import { FormDialog } from '@/components/admin/form-dialog';
import { ErrorNotice, NoAccess } from '@/components/admin/page-state';
import { Pager } from '@/components/admin/pager';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { callApi, requestInit } from '@/lib/api/admin';
import { getMe } from '@/lib/api/me';
import { canAny } from '@/lib/permissions';
import { createRoleAction, deleteRoleAction, updateRoleAction } from './actions';
import { RoleFields } from './role-fields';

export const metadata: Metadata = { title: 'Roles' };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const me = await getMe();
  if (me.ok && !canAny(me.data.permissions, 'roles:manage')) return <NoAccess />;
  const list = await callApi((api) => api.GET('/roles', { params: { query: { cursor, limit: 50 } }, ...requestInit() }), { canRefresh: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roles</h1>
        <FormDialog trigger="Nuevo rol" triggerVariant="default" title="Nuevo rol" description="Elige los permisos del rol. Solo puedes otorgar permisos que tú tienes." submitLabel="Crear" action={createRoleAction}>
          <RoleFields />
        </FormDialog>
      </div>
      {!list.ok ? (
        <ErrorNotice message={list.message} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Permisos</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((role) => {
                const isOwner = role.key === 'owner';
                return (
                  <TableRow key={role.id}>
                    <TableCell>{role.name}</TableCell>
                    <TableCell>{role.isSystem ? <Badge variant="secondary">Sistema</Badge> : <Badge variant="outline">Personalizado</Badge>}</TableCell>
                    <TableCell>{role.permissions.length}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      {isOwner ? (
                        <FormDialog readOnly trigger="Ver" title={`Permisos de ${role.name}`} description="El rol Propietario no se puede editar." submitLabel="Cerrar">
                          <RoleFields id={role.id} name={role.name} permissions={role.permissions} readOnly />
                        </FormDialog>
                      ) : (
                        <FormDialog trigger="Editar" title={`Editar ${role.name}`} submitLabel="Guardar" action={updateRoleAction}>
                          <RoleFields id={role.id} name={role.name} permissions={role.permissions} />
                        </FormDialog>
                      )}
                      {role.isSystem ? null : (
                        <FormDialog trigger="Eliminar" destructive title={`Eliminar ${role.name}`} description="Un rol en uso no se puede eliminar." submitLabel="Eliminar" action={deleteRoleAction}>
                          <input type="hidden" name="id" value={role.id} />
                        </FormDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pager basePath="/roles" nextCursor={list.data.nextCursor} />
        </>
      )}
    </div>
  );
}
